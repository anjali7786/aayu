"""
Aayu ADK orchestrator.

Wires three LlmAgents into a SequentialAgent:
    1. Exposure Analyst      — reads BQ, summarizes environmental risk
    2. Shelf-Life Analyst    — calls BQML, interprets prediction in context
    3. Decision Agent        — synthesizes both into a final recommendation

Tools come from an MCP Toolbox server running on http://127.0.0.1:5000/mcp.
Start the Toolbox before invoking this orchestrator:

    export GOOGLE_APPLICATION_CREDENTIALS=/path/to/gcp-key.json
    ./bin/toolbox --tools-file mcp/tools.yaml

Then run this module:

    python -m agents.orchestrator b_0001
"""

from __future__ import annotations

import truststore

truststore.inject_into_ssl()

import os

from dotenv import load_dotenv

load_dotenv()

from google.adk.agents import LlmAgent, SequentialAgent
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPServerParams
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset

MODEL = "gemini-2.5-flash"
MCP_URL = os.environ.get("AAYU_MCP_URL", "http://127.0.0.1:5000/mcp")


def _mcp_toolset(tool_filter: list[str] | None = None) -> MCPToolset:
    """Wrap the MCP Toolbox at MCP_URL, optionally filtering to a subset of tools."""
    return MCPToolset(
        connection_params=StreamableHTTPServerParams(url=MCP_URL),
        tool_filter=tool_filter,
    )


# ---- 1. Exposure Analyst -------------------------------------------------
exposure_analyst = LlmAgent(
    name="exposure_analyst",
    model=MODEL,
    instruction=(
        "You are an environmental exposure analyst for a cold-chain food logistics system. "
        "You will be given a batch_id in the user input. Your job is to:\n"
        "  1. Call `get-batch-features` to see the aggregated damage signals.\n"
        "  2. Call `get-batch-telemetry-summary` for at-a-glance temperature/humidity stats.\n"
        "  3. Optionally call `get-batch-events` if timing context matters.\n"
        "Then produce a structured exposure summary as JSON with these fields:\n"
        "  - risk_level:       'minimal' | 'moderate' | 'severe'\n"
        "  - primary_concern:  'thermal_excursion' | 'humidity' | 'prolonged_transit' | 'none'\n"
        "  - key_events:       list of short factual strings citing numbers "
        "                      (e.g. '6.25h excursion at 10.77°C during transit')\n"
        "  - narrative:        2-3 sentence plain-language description\n"
        "Cite only numeric values from the tool results. Never invent numbers."
    ),
    tools=[
        _mcp_toolset(
            [
                "get-batch-features",
                "get-batch-telemetry-summary",
                "get-batch-events",
            ]
        )
    ],
    output_key="exposure_summary",
)


# ---- 2. Shelf-Life Analyst ----------------------------------------------
shelf_life_analyst = LlmAgent(
    name="shelf_life_analyst",
    model=MODEL,
    instruction=(
        "You are a shelf-life analyst. You have been given the exposure summary "
        "from the prior agent:\n\n{exposure_summary}\n\n"
        "The batch_id is in the original user input. Your job is to:\n"
        "  1. Call `predict-shelf-life` with the batch_id. The tool returns three "
        "     numbers: predicted_remaining_life_hours, ground_truth_remaining_life_hours, "
        "     and nominal_shelf_life_hours.\n"
        "  2. Return those numbers VERBATIM in the fields below. Do NOT round, do NOT "
        "     adjust, do NOT reinterpret. The tool's output is authoritative — you are "
        "     ONLY forwarding it, not modifying it.\n"
        "  3. Compute pct_of_nominal = predicted_remaining_life_hours / nominal_shelf_life_hours * 100.\n"
        "  4. Write a 2-3 sentence interpretation that references the exact prediction "
        "     value and connects it to the exposure summary.\n\n"
        "Return a structured JSON with these fields:\n"
        "  - predicted_remaining_hours:  float, EXACTLY the tool's predicted_remaining_life_hours value\n"
        "  - ground_truth_remaining_hours: float, EXACTLY the tool's ground_truth_remaining_life_hours value\n"
        "  - pct_of_nominal:             float, predicted / nominal * 100\n"
        "  - confidence:                 'low' | 'medium' | 'high'\n"
        "  - interpretation:             2-3 sentences relating prediction to exposure\n\n"
        "CRITICAL: predicted_remaining_hours must equal the tool's output down to two decimals. "
        "If the tool returns 87.32, return 87.32. Never round up. Never adjust for optimism. "
        "The model has already accounted for all the exposure signals."
    ),
    tools=[_mcp_toolset(["predict-shelf-life"])],
    output_key="shelf_life_analysis",
)


# ---- 3. Decision Agent --------------------------------------------------
decision_agent = LlmAgent(
    name="decision_agent",
    model=MODEL,
    instruction=(
        "You are the decision agent. You have been given two upstream reports:\n\n"
        "EXPOSURE SUMMARY:\n{exposure_summary}\n\n"
        "SHELF-LIFE ANALYSIS:\n{shelf_life_analysis}\n\n"
        "Produce the final operator-facing recommendation as JSON with these fields:\n"
        "  - headline:            one sentence, what the store manager needs to know\n"
        "  - recommended_action:  one of "
        "                         'Sell Normally' | 'Prioritize Sale' | 'Discount' | "
        "                         'Inspect' | 'Quarantine'\n"
        "  - confidence:          'low' | 'medium' | 'high'\n"
        "  - explanation:         2-3 sentences citing specific numbers from the reports\n\n"
        "Action rules — evaluate top-down, first match wins. Combines two signals:\n"
        "  (a) health_ratio = predicted_remaining_hours / printed_remaining_hours "
        "      — how much life Aayu says vs. what the label promises. 1.0 means "
        "      Aayu agrees with the label; < 1.0 means cold-chain wear.\n"
        "  (b) nominal_fraction = predicted_remaining_hours / nominal_shelf_life_hours "
        "      — a per-product safety floor. Absolute hours would be wrong here "
        "      (24h of berry life ≠ 24h of hard cheese life); a fraction of nominal "
        "      scales correctly across every SKU.\n"
        "Both are computed from fields in the shelf_life_analysis JSON.\n"
        "  - 'Quarantine' when excursion peak > 8°C over max, OR nominal_fraction < 0.05, "
        "    OR health_ratio < 0.3.\n"
        "  - 'Discount' when nominal_fraction < 0.10, OR health_ratio in [0.3, 0.6).\n"
        "  - 'Inspect' when health_ratio >= 0.6 AND excursion peak > 5°C (damage above tolerance).\n"
        "  - 'Prioritize Sale' when health_ratio in [0.6, 0.9).\n"
        "  - 'Sell Normally' when health_ratio >= 0.9."
    ),
    output_key="decision",
)


# ---- Orchestrator: run all three in order ------------------------------
aayu_orchestrator = SequentialAgent(
    name="aayu_orchestrator",
    sub_agents=[exposure_analyst, shelf_life_analyst, decision_agent],
)


# ---- CLI runner --------------------------------------------------------
def _run_cli(batch_id: str) -> None:
    """Run the orchestrator once for a batch_id and print the final session state."""
    import asyncio
    import json

    from google.adk.runners import InMemoryRunner
    from google.genai import types

    runner = InMemoryRunner(agent=aayu_orchestrator, app_name="aayu")

    async def go():
        session = await runner.session_service.create_session(app_name="aayu", user_id="cli")
        message = types.Content(
            role="user",
            parts=[types.Part(text=f"Assess batch_id={batch_id}")],
        )
        async for event in runner.run_async(
            user_id="cli", session_id=session.id, new_message=message
        ):
            if event.author and event.content:
                text = "".join(p.text or "" for p in event.content.parts if p.text)
                if text.strip():
                    print(f"\n=== {event.author} ===\n{text}")

        # Print final consolidated state
        session = await runner.session_service.get_session(
            app_name="aayu", user_id="cli", session_id=session.id
        )
        print("\n=== FINAL STATE ===")
        for key in ("exposure_summary", "shelf_life_analysis", "decision"):
            if key in session.state:
                print(f"\n--- {key} ---")
                val = session.state[key]
                if isinstance(val, str):
                    try:
                        parsed = json.loads(val)
                        print(json.dumps(parsed, indent=2))
                    except json.JSONDecodeError:
                        print(val)
                else:
                    print(json.dumps(val, indent=2, default=str))

    asyncio.run(go())


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python -m agents.orchestrator <batch_id>")
        sys.exit(1)
    _run_cli(sys.argv[1])
