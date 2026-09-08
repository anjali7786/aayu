-- Which features the boosted tree relied on most.
SELECT * FROM ML.FEATURE_IMPORTANCE(MODEL `aayu.shelf_life_boosted_tree`)
ORDER BY importance_weight DESC;
