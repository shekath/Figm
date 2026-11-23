import { useEditor } from '../store/store';
import { unionRects, visualBounds } from '../lib/geometry';

const STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

export function Rulers() {
  const { zoom, panX, panY } = useEditor();
  const st = useEditor.getState();
  const step = STEPS.find((s) => s * zoom >= 50) ?? 10000;
  const sb = unionRects(st.selectedNodes().map(visualBounds));
  const ticks = (len: number, pan: number) => {
    const out: number[] = [];
    const start = Math.floor(-pan / zoom / step) * step;
    for (let v = start; v * zoom + pan < len; v += step) out.push(v);
    return out;
  };
  const W = 4000;
  return (
    <>
      <svg className="ruler ruler-h" width="100%" height={20}>
        {sb && <rect x={sb.x * zoom + panX} y={0} width={sb.w * zoom} height={20} fill="rgba(13,153,255,0.18)" />}
        {ticks(W, panX).map((v) => (
          <g key={v} transform={`translate(${v * zoom + panX},0)`}>
            <line y1={14} y2={20} stroke="currentColor" opacity={0.5} />
            <text x={3} y={11} fontSize={9} fill="currentColor" opacity={0.7}>
              {v}
            </text>
          </g>
        ))}
      </svg>
      <svg className="ruler ruler-v" width={20} height="100%">
        {sb && <rect y={sb.y * zoom + panY} x={0} height={sb.h * zoom} width={20} fill="rgba(13,153,255,0.18)" />}
        {ticks(W, panY).map((v) => (
          <g key={v} transform={`translate(0,${v * zoom + panY})`}>
            <line x1={14} x2={20} stroke="currentColor" opacity={0.5} />
            <text x={11} y={3} fontSize={9} fill="currentColor" opacity={0.7} transform="rotate(-90 11 3)" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
      </svg>
    </>
  );
}
