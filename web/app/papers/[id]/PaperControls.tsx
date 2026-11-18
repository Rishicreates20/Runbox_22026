"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatClock, loadExam, saveExam, type ExamState } from "@/lib/exam";

interface Props {
  paperId: string;
  durationMin: number;
  firstSlug: string;
  score: { solved: number; checkable: number };
}

/** Start / resume / finish controls and the score, driven by the local timer. */
export default function PaperControls({ paperId, durationMin, firstSlug, score }: Props) {
  const router = useRouter();
  const [state, setState] = useState<ExamState | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setState(loadExam(paperId));
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [paperId]);

  const update = (s: ExamState) => {
    saveExam(paperId, s);
    setState(s);
  };
  const start = () => {
    update({ startedAt: Date.now() });
    router.push(`/problems/${firstSlug}`);
  };

  if (state === null) return <div className="paper-controls" />;

  const left = state.startedAt ? state.startedAt + durationMin * 60_000 - now : 0;
  const finished = Boolean(state.finishedAt) || (state.startedAt && left <= 0 && !state.untimed);

  if (!state.startedAt) {
    return (
      <div className="paper-controls">
        <button className="btn primary big" onClick={start} disabled={!firstSlug}>
          Start paper · {durationMin} min
        </button>
        <p className="hint">
          The clock starts now and runs in this browser. Move between questions with the Q chips or Prev/Next, and press
          Finish when you&apos;re done. Questions with sample output are checked when you Submit; the rest are run-only.
        </p>
      </div>
    );
  }

  if (finished) {
    const used = (state.finishedAt ?? state.startedAt + durationMin * 60_000) - state.startedAt;
    return (
      <div className="paper-controls">
        <div className="paper-score">
          <div>
            <div className="verdict v-AC">
              {score.solved} / {score.checkable}
            </div>
            <div className="hint">checkable questions accepted</div>
          </div>
          <div>
            <div className="verdict">{formatClock(Math.min(used, durationMin * 60_000))}</div>
            <div className="hint">time used of {durationMin}:00</div>
          </div>
        </div>
        <button className="btn" onClick={start}>
          Retake with a fresh timer
        </button>
      </div>
    );
  }

  return (
    <div className="paper-controls">
      <button className="btn primary big" onClick={() => router.push(`/problems/${firstSlug}`)}>
        Resume{state.untimed ? " (untimed)" : ` · ${formatClock(left)} left`}
      </button>
      <button className="btn" style={{ marginLeft: 8 }} onClick={() => update({ ...state, finishedAt: Date.now() })}>
        Finish now
      </button>
    </div>
  );
}
