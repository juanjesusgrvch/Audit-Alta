export function PaginationControls({
  currentPage,
  onPageChange,
  totalPages
}: {
  currentPage: number;
  onPageChange: (nextPage: number) => void;
  totalPages: number;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, startPage + 4);
  const visiblePages = [];

  for (let page = startPage; page <= endPage; page += 1) {
    visiblePages.push(page);
  }

  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
      <p className="text-xs font-semibold text-[var(--text-muted)]">
        Pagina {currentPage} de {totalPages}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="console-secondary-button rounded-xl px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-45"
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
          type="button"
        >
          Anterior
        </button>
        {visiblePages.map((page) => (
          <button
            className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
              currentPage === page
                ? "bg-[var(--nav-active-bg)] text-[var(--primary)] ring-1 ring-[var(--line-strong)]"
                : "bg-[var(--surface-low)] text-[var(--text-soft)] ring-1 ring-[var(--line)] hover:text-[var(--text)]"
            }`}
            key={page}
            onClick={() => onPageChange(page)}
            type="button"
          >
            {page}
          </button>
        ))}
        <button
          className="console-secondary-button rounded-xl px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-45"
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          type="button"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}
