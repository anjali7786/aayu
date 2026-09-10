import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchBatches } from '../services/api';
import {
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  ArrowRight,
  Barcode
} from 'lucide-react';

interface BatchListPageProps {
  onOpenQR?: () => void;
}

type SortColumn = 'batch' | 'brand' | 'lot' | 'manufactured' | 'expiry';
type SortOrder = 'asc' | 'desc';

export const BatchListPage: React.FC<BatchListPageProps> = ({ onOpenQR }) => {
  const navigate = useNavigate();

  // Query batches with tanstack query
  const { data: batches = [], isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['batches'],
    queryFn: fetchBatches,
    staleTime: 1000 * 60 * 5,
  });

  // State for search and filter chips
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProductType, setSelectedProductType] = useState<string>('All');

  // Sorting state
  const [sortColumn, setSortColumn] = useState<SortColumn>('batch');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // Format product name helper
  const formatProductName = (type?: string, displayName?: string) => {
    if (displayName) return displayName;
    if (!type) return 'Perishable Batch';
    return type
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  };

  // Derive filter chips dynamically from the GET /batches result
  const filterChips = useMemo(() => {
    const fromApi = new Set<string>();
    batches.forEach((b) => {
      if (b.product_type) {
        fromApi.add(formatProductName(b.product_type));
      }
    });

    const list = ['All'];
    Array.from(fromApi).sort().forEach((chip) => list.push(chip));
    return list;
  }, [batches]);

  // Handle Sort Header Click
  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(col);
      setSortOrder('asc');
    }
    setPage(1);
  };

  // Filtered & Sorted Batches
  const filteredBatches = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return batches.filter((b) => {
      const matchBatchId = b.batch_id?.toLowerCase().includes(q);
      const matchDisplayName = (b.display_name || formatProductName(b.product_type)).toLowerCase().includes(q);
      const matchesSearch = !q || matchBatchId || matchDisplayName;

      const productFormatted = formatProductName(b.product_type);
      const matchesFilter = selectedProductType === 'All' || productFormatted.toLowerCase() === selectedProductType.toLowerCase();

      return matchesSearch && matchesFilter;
    });
  }, [batches, searchQuery, selectedProductType]);

  const sortedBatches = useMemo(() => {
    const list = [...filteredBatches];

    list.sort((a, b) => {
      let valA = '';
      let valB = '';

      switch (sortColumn) {
        case 'batch': {
          const numA = parseInt(a.batch_id.replace(/\D/g, ''), 10) || 0;
          const numB = parseInt(b.batch_id.replace(/\D/g, ''), 10) || 0;
          return sortOrder === 'asc' ? numA - numB : numB - numA;
        }
        case 'brand': {
          valA = a.brand_name || 'Amul Dairy';
          valB = b.brand_name || 'Amul Dairy';
          break;
        }
        case 'lot': {
          valA = a.lot_number || `LOT-${a.batch_id}`;
          valB = b.lot_number || `LOT-${b.batch_id}`;
          break;
        }
        case 'manufactured': {
          valA = a.manufacture_ts || '';
          valB = b.manufacture_ts || '';
          break;
        }
        case 'expiry': {
          valA = a.expiry_date || a.retail_in_ts || '';
          valB = b.expiry_date || b.retail_in_ts || '';
          break;
        }
      }

      return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });

    return list;
  }, [filteredBatches, sortColumn, sortOrder]);

  // Paginated View
  const totalPages = Math.ceil(sortedBatches.length / pageSize) || 1;
  const paginatedBatches = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedBatches.slice(start, start + pageSize);
  }, [sortedBatches, page, pageSize]);

  // Date formatter
  const formatDate = (isoStr?: string) => {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-6">
      {/* Header row: "Batch portfolio" (title) + search input + "Scan" button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Batch portfolio
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-slate-100 text-slate-700 border border-slate-200">
              {batches.length} total
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Real-time cold-chain registry across dairy, fresh produce, juices, and proteins.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Search input */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by ID or product..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-lg pl-9 pr-3 py-2.5 placeholder-slate-400 focus:outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400 shadow-2xs font-mono"
            />
          </div>

          {/* Persistent Scan button in header */}
          {onOpenQR && (
            <button
              type="button"
              onClick={onOpenQR}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium transition-all shadow-xs cursor-pointer shrink-0 active:scale-95"
            >
              <Barcode className="w-3.5 h-3.5 text-slate-200" />
              <span>Scan</span>
            </button>
          )}

          <button
            onClick={() => refetch()}
            disabled={isLoading || isRefetching}
            title="Refresh batches"
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors shadow-2xs shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading || isRefetching ? 'animate-spin text-slate-900' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filter Chips: All + one per product_type (populate dynamically) */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
        {filterChips.map((chip) => {
          const isSelected = selectedProductType.toLowerCase() === chip.toLowerCase();
          return (
            <button
              key={chip}
              onClick={() => {
                setSelectedProductType(chip);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-2xs'
              }`}
            >
              {chip}
            </button>
          );
        })}
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-[12px] bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>Failed to load batches from API. {String(error)}</span>
          </div>
          <button
            onClick={() => refetch()}
            className="text-xs font-semibold underline hover:no-underline text-rose-900"
          >
            Retry
          </button>
        </div>
      )}

      {/* Data Table */}
      <div className="bg-white border border-slate-200 rounded-[12px] overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            {/* Table Headers */}
            <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
              <tr>
                {/* Column: Batch (batch_id + display_name) */}
                <th
                  onClick={() => handleSort('batch')}
                  className="px-6 py-3.5 cursor-pointer hover:text-slate-900 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Batch</span>
                    {sortColumn === 'batch' ? (
                      sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-slate-900" /> : <ArrowDown className="w-3.5 h-3.5 text-slate-900" />
                    ) : (
                      <ArrowUpDown className="w-3 h-3 text-slate-300" />
                    )}
                  </div>
                </th>

                {/* Column: Brand */}
                <th
                  onClick={() => handleSort('brand')}
                  className="px-6 py-3.5 cursor-pointer hover:text-slate-900 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Brand</span>
                    {sortColumn === 'brand' ? (
                      sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-slate-900" /> : <ArrowDown className="w-3.5 h-3.5 text-slate-900" />
                    ) : (
                      <ArrowUpDown className="w-3 h-3 text-slate-300" />
                    )}
                  </div>
                </th>

                {/* Column: Lot */}
                <th
                  onClick={() => handleSort('lot')}
                  className="px-6 py-3.5 cursor-pointer hover:text-slate-900 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Lot</span>
                    {sortColumn === 'lot' ? (
                      sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-slate-900" /> : <ArrowDown className="w-3.5 h-3.5 text-slate-900" />
                    ) : (
                      <ArrowUpDown className="w-3 h-3 text-slate-300" />
                    )}
                  </div>
                </th>

                {/* Column: Manufactured */}
                <th
                  onClick={() => handleSort('manufactured')}
                  className="px-6 py-3.5 cursor-pointer hover:text-slate-900 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Manufactured</span>
                    {sortColumn === 'manufactured' ? (
                      sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-slate-900" /> : <ArrowDown className="w-3.5 h-3.5 text-slate-900" />
                    ) : (
                      <ArrowUpDown className="w-3 h-3 text-slate-300" />
                    )}
                  </div>
                </th>

                {/* Column: Expiry */}
                <th
                  onClick={() => handleSort('expiry')}
                  className="px-6 py-3.5 cursor-pointer hover:text-slate-900 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Expiry</span>
                    {sortColumn === 'expiry' ? (
                      sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-slate-900" /> : <ArrowDown className="w-3.5 h-3.5 text-slate-900" />
                    ) : (
                      <ArrowUpDown className="w-3 h-3 text-slate-300" />
                    )}
                  </div>
                </th>

                {/* Column: Action "View →" */}
                <th className="px-6 py-3.5 text-right">Action</th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                // Shimmer skeleton rows
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-4">
                      <div className="space-y-1.5">
                        <div className="h-4 w-16 bg-slate-200 rounded"></div>
                        <div className="h-3 w-32 bg-slate-100 rounded"></div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-4 w-24 bg-slate-200 rounded"></div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-4 w-20 bg-slate-200 rounded"></div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-4 w-28 bg-slate-200 rounded"></div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-4 w-28 bg-slate-200 rounded"></div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="h-7 w-16 bg-slate-200 rounded ml-auto"></div>
                    </td>
                  </tr>
                ))
              ) : sortedBatches.length === 0 ? (
                // Empty state: "No batches match your filters."
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center text-slate-500">
                    <p className="text-base font-medium text-slate-800">No batches match your filters.</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Try adjusting your search query or selecting &ldquo;All&rdquo; filter.
                    </p>
                  </td>
                </tr>
              ) : (
                paginatedBatches.map((batch) => {
                  const brand = batch.brand_name || 'Amul Dairy';
                  const lot = batch.lot_number || `L${batch.batch_id.replace('b_', '2608')}`;
                  const productName = formatProductName(batch.product_type, batch.display_name);

                  // Nominal expiry calculation
                  const mfg = new Date(batch.manufacture_ts);
                  const expDate = batch.expiry_date || new Date(mfg.getTime() + batch.nominal_shelf_life_hours * 3600 * 1000).toISOString();

                  return (
                    <tr
                      key={batch.batch_id}
                      onClick={() => navigate(`/batches/${batch.batch_id}`)}
                      className="hover:bg-slate-50/80 cursor-pointer transition-colors group"
                    >
                      {/* Batch Column (batch_id + display_name) */}
                      <td className="px-6 py-4">
                        <div className="space-y-0.5">
                          <span className="font-mono font-semibold text-slate-900 group-hover:text-slate-700 transition-colors">
                            {batch.batch_id}
                          </span>
                          <span className="text-xs text-slate-600 block font-normal">
                            {productName}
                          </span>
                        </div>
                      </td>

                      {/* Brand Column */}
                      <td className="px-6 py-4 text-slate-700 font-medium">
                        {brand}
                      </td>

                      {/* Lot Column */}
                      <td className="px-6 py-4 font-mono text-xs text-slate-500">
                        {lot}
                      </td>

                      {/* Manufactured Column */}
                      <td className="px-6 py-4 font-mono text-xs text-slate-600">
                        {formatDate(batch.manufacture_ts)}
                      </td>

                      {/* Expiry Column */}
                      <td className="px-6 py-4 font-mono text-xs text-slate-600">
                        {formatDate(expDate)}
                      </td>

                      {/* Action button "View →" */}
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/batches/${batch.batch_id}`);
                          }}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white group-hover:bg-slate-900 group-hover:text-white group-hover:border-slate-900 text-slate-700 text-xs font-medium transition-all inline-flex items-center gap-1 cursor-pointer shadow-2xs"
                        >
                          <span>View</span>
                          <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {sortedBatches.length > 0 && (
          <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <div>
              Showing <span className="font-mono font-medium text-slate-800">{(page - 1) * pageSize + 1}</span> to{' '}
              <span className="font-mono font-medium text-slate-800">{Math.min(page * pageSize, sortedBatches.length)}</span> of{' '}
              <span className="font-mono font-medium text-slate-800">{sortedBatches.length}</span> batches
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors shadow-2xs"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-mono px-2">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors shadow-2xs"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
