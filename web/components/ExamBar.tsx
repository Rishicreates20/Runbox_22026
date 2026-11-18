"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatClock, loadExam, saveExam, type ExamState } from "@/lib/exam";

interface Props {
  paperId: string;
  title: string;
  durationMin: number;
  questions: { slug: string; title: string }[];
  current: string;
}

/** Exam header on a mock-paper question: paper link, question chips, timer. */
export default function ExamBar({ paperId, title, durationMin, questions, current }: Props) {
  const router = useRouter();
  const [state, setState] = useState<ExamState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let s = loadExam(paperId);
    // Opening a question starts the clock if the paper page didn't.
    if (!s.startedAt) {
      s = { startedAt: Date.now() };
      saveExam(paperId, s);
    }
    setState(s);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [paperId]);

  const update = (s: ExamState) => {
    saveExam(paperId, s);
    setState(s);
  };
  const finish = () => {
    if (state) update({ ...state, finishedAt: state.finishedAt ?? Date.now() });
    router.push(`/papers/${paperId}`);
  };

  const left = state?.startedAt ? state.startedAt + durationMin * 60_000 - now : durationMin * 60_000;
  const timed = state && !state.finishedAt && !state.untimed;
  const timeUp = Boolean(timed && left <= 0);
  const idx = questions.findIndex((q) => q.slug === current);

  return (
    <>
      <div className="exam-bar">
        <Link href={`/papers/${paperId}`} className="exam-title" title="Paper overview">
          ← {title}
        </Link>
        <nav className="exam-chips" aria-label="Questions">
          {questions.map((q, i) => (
            <Link
              key={q.slug}
              href={`/problems/${q.slug}`}
              className={`exam-chip ${i === idx ? "active" : ""}`}
              title={q.title}
              aria-current={i === idx ? "page" : undefined}
            >
              Q{i + 1}
            </Link>
          ))}
        </nav>
        <span className="spacer" />
        {state === null ? null : timed ? (
          <span className={`exam-clock ${left < 60_000 ? "bad" : left < 5 * 60_000 ? "warn" : ""}`} title="Time left">
            ⏱ {formatClock(left)}
          </span>
        ) : (
          <span className="hint">{state.finishedAt ? "Finished · practising untimed" : "Untimed"}</span>
        )}
        {state && !state.finishedAt &&
          (confirming ? (
            <span className="exam-confirm">
              Finish the paper?
              <button className="btn small primary" onClick={finish}>
                Yes, finish
              </button>
              <button className="btn small" onClick={() => setConfirming(false)}>
                No
              </button>
            </span>
          ) : (
            <button className="btn small" onClick={() => setConfirming(true)}>
              Finish
            </button>
          ))}
      </div>

      {timeUp && state && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="timeup-title">
          <div className="modal">
            <h2 id="timeup-title">Time&apos;s up</h2>
            <p className="hint">
              Your {durationMin} minutes are over. See how you did, or keep working on the questions without the clock.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => update({ ...state, untimed: true })}>
                Keep practising
              </button>
              <button className="btn primary" onClick={finish}>
                See results
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
