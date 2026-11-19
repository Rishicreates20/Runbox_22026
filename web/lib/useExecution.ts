"use client";

import { useEffect, useRef, useState } from "react";
import type { ExecEvent } from "@codeplus/shared";

const TYPES: ExecEvent["type"][] = ["queued", "compiling", "running", "test_result", "completed"];

/**
 * Follows /api/execution/{id} with EventSource. The browser reconnects on
 * its own after a drop and sends Last-Event-ID, and the server replays only
 * what was missed, so this hook just accumulates events.
 */
export function useExecution(id: string | null) {
  const [events, setEvents] = useState<ExecEvent[]>([]);
  const [connectionLost, setConnectionLost] = useState(false);
  // The server has neither a live event log nor a stored result (e.g. the
  // judge died and the log's TTL ran out). Nothing more will arrive.
  const [expired, setExpired] = useState(false);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    setEvents([]);
    setConnectionLost(false);
    setExpired(false);
    seen.current = new Set();
    if (!id) return;
    const es = new EventSource(`/api/execution/${id}`);
    const onEvent = (msg: MessageEvent<string>) => {
      if (msg.lastEventId && seen.current.has(msg.lastEventId)) return;
      seen.current.add(msg.lastEventId);
      const event = JSON.parse(msg.data) as ExecEvent;
      setConnectionLost(false);
      setEvents((prev) => [...prev, event]);
      if (event.type === "completed") es.close(); // otherwise the browser would reconnect
    };
    for (const t of TYPES) es.addEventListener(t, onEvent as EventListener);
    es.addEventListener("expired", () => {
      es.close();
      setExpired(true);
    });
    es.onerror = () => setConnectionLost(es.readyState !== EventSource.CLOSED);
    return () => es.close();
  }, [id]);

  const done = events.find((e) => e.type === "completed") as Extract<ExecEvent, { type: "completed" }> | undefined;
  return { events, done, connectionLost, expired };
}
