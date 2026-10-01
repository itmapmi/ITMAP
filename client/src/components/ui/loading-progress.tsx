export function LoadingProgress({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="px-4 py-8 sm:px-6"
      data-testid="loading-progress"
    >
      <p className="mb-3 text-sm text-[#66737b]">{label}</p>
      <div
        role="progressbar"
        aria-label={label}
        className="h-1.5 overflow-hidden rounded-full bg-[#e6eef3]"
      >
        <div className="h-full w-1/3 rounded-full bg-[#13a8f0] animate-[loading-progress_1.4s_ease-in-out_infinite] motion-reduce:animate-none motion-reduce:translate-x-full" />
      </div>
    </div>
  );
}