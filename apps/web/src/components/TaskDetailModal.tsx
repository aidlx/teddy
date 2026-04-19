'use client';

import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  TaskDetailClient,
  type TaskAnchorEvent,
  type TaskCourse,
  type TaskRecord,
} from '@/app/tasks/[id]/task-detail-client';

export function TaskDetailModal({
  taskId,
  userTz,
  onClose,
  onChanged,
}: {
  taskId: string;
  userTz: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [courses, setCourses] = useState<TaskCourse[]>([]);
  const [anchorEvent, setAnchorEvent] = useState<TaskAnchorEvent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = getBrowserSupabase();
      const { data: taskRow, error: taskError } = await supabase
        .from('tasks')
        .select(
          'id, title, description, due_at, due_kind, due_tz, anchor_event_id, offset_minutes, completed_at, course_id, capture_id, created_at',
        )
        .eq('id', taskId)
        .maybeSingle();

      if (cancelled) return;
      if (taskError) {
        setLoadError(taskError.message);
        return;
      }
      if (!taskRow) {
        setLoadError('Task not found.');
        return;
      }

      const [coursesRes, anchorRes] = await Promise.all([
        supabase.from('courses').select('id, name, color').order('created_at'),
        taskRow.anchor_event_id
          ? supabase
              .from('events')
              .select('id, title, location, start_at, end_at, source_tz, course_id')
              .eq('id', taskRow.anchor_event_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (cancelled) return;

      setTask(taskRow as TaskRecord);
      setCourses((coursesRes.data ?? []) as TaskCourse[]);
      setAnchorEvent((anchorRes.data ?? null) as TaskAnchorEvent | null);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  return (
    <Modal onClose={onClose} ariaLabel="Task details">
      <div className="flex flex-col gap-5 px-5 py-6 md:px-8 md:py-8">
        <header className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">Task</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Update this task or change when it is due.
          </p>
        </header>
        {loadError && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            {loadError}
          </p>
        )}
        {!task && !loadError && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
        )}
        {task && (
          <TaskDetailClient
            initialTask={task}
            courses={courses}
            anchorEvent={anchorEvent}
            userTz={userTz}
            onSaved={() => onChanged?.()}
            onDeleted={() => {
              onChanged?.();
              onClose();
            }}
          />
        )}
      </div>
    </Modal>
  );
}
