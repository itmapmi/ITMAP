import { QuadrantChart } from "./_QuadrantChart";

export function RankBased() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 p-8 gap-3">
      <div className="text-center">
        <h2 className="text-lg font-bold text-slate-800">Rank-based even spacing</h2>
        <p className="text-sm text-slate-500">Size 860×640 — dots placed by rank order, evenly spread regardless of how close raw scores are</p>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
        <QuadrantChart width={860} height={640} normMin={10} normMax={90} dotR={9} fontSize={13} mode="rank" />
      </div>
    </div>
  );
}
