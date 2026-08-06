import { useCallback, useEffect, useRef, useState } from "react";

export type TicketStatus = "open" | "in_progress" | "blocked" | "done";
export type TicketPriority = "low" | "med" | "high";

export interface Ticket {
  id: number;
  title: string;
  body: string;
  status: TicketStatus;
  priority: TicketPriority;
  project: string;
  assignee: string | null;
  parentId: number | null;
  createdAt: number;
  updatedAt: number;
}

const POLL_INTERVAL_MS = 2000;

export interface UseTicketsResult {
  tickets: Ticket[];
  error: string | null;
  createTicket: (input: { title: string; project: string; priority?: TicketPriority }) => Promise<{ ok: boolean; error?: string }>;
  updateTicket: (id: number, input: Partial<Pick<Ticket, "status" | "title" | "body" | "priority">>) => Promise<{ ok: boolean; error?: string }>;
  deleteTicket: (id: number) => Promise<{ ok: boolean; error?: string }>;
}

export function useTickets(): UseTicketsResult {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const res = await fetch("/api/tickets");
        if (!res.ok) throw new Error(`Failed to list tickets (${res.status})`);
        const body: Ticket[] = await res.json();
        if (!cancelled) {
          setTickets(body);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        fetchingRef.current = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const createTicket = useCallback(async (input: { title: string; project: string; priority?: TicketPriority }) => {
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.error ?? `Failed (${res.status})` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  const updateTicket = useCallback(
    async (id: number, input: Partial<Pick<Ticket, "status" | "title" | "body" | "priority">>) => {
      try {
        const res = await fetch(`/api/tickets/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return { ok: false, error: body.error ?? `Failed (${res.status})` };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [],
  );

  const deleteTicket = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/tickets/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.error ?? `Failed (${res.status})` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  return { tickets, error, createTicket, updateTicket, deleteTicket };
}
