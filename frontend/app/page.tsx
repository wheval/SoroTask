"use client";

import { FormEvent, useCallback, useMemo, useRef, useState } from "react";
import PredictiveFailureAnalysisPanel from "./components/PredictiveFailureAnalysisPanel";
import usePredictiveFailureAnalysis from "./hooks/usePredictiveFailureAnalysis";

export default function Home() {
  const [taskData, setTaskData] = useState({
    contractAddress: '',
    functionName: '',
    interval: '',
    gasBalance: '',
    dueDate: '',
    parsedDueDate: undefined as Date | undefined,
    // VRF-related fields
    useVrf: false,
    vrfCallbackFunction: '',
    vrfCallbackArgs: ''
  });
  const initialForm = useRef(form);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({
      ...task,
      contractAddress: form.contractAddress.trim(),
      functionName: form.functionName.trim(),
      interval: Number(form.interval) || task.interval,
      gasBalance: Number(form.gasBalance) || task.gasBalance,
    });
  };

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  const confirmDiscard = () => {
    const changed =
      form.contractAddress !== initialForm.current.contractAddress ||
      form.functionName !== initialForm.current.functionName ||
      form.interval !== initialForm.current.interval ||
      form.gasBalance !== initialForm.current.gasBalance;

    if (!changed) {
      return true;
    }

    return window.confirm("Discard unsaved changes?");
  };

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && confirmDiscard()) {
      onClose();
    }
  };

  const handleCancel = () => {
    if (confirmDiscard()) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      role="presentation"
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-task-dialog-title"
        className="w-full max-w-lg rounded-3xl border border-neutral-700/80 bg-neutral-950 p-6 shadow-2xl shadow-black/40"
        onKeyDown={handleKeyDown}
      >
        <h2 id="edit-task-dialog-title" className="text-xl font-semibold text-neutral-100 mb-4">
          Edit Task #{task.id}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="edit-contract" className="block text-sm font-medium text-neutral-400 mb-1">
              Target Contract Address
            </label>
            <input
              id="edit-contract"
              type="text"
              value={form.contractAddress}
              onChange={(event) => setForm({ ...form, contractAddress: event.target.value })}
              required
              autoComplete="off"
              className="w-full rounded-2xl border border-neutral-700/80 bg-neutral-900 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div>
            <h2 className="text-3xl font-bold">Your Keeper Dashboard</h2>
            <p className="text-neutral-400">Create, manage, and reorder recurring tasks with instant feedback.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={syncTasks}
              className="rounded-lg border border-neutral-700/80 bg-neutral-800/80 px-4 py-2 text-sm text-neutral-200 transition hover:border-neutral-500"
            >
              {isLoading ? 'Refreshing…' : 'Refresh tasks'}
            </button>
            <div className="text-sm text-neutral-400">{activeTaskCount} active tasks</div>
          </div>
        </div>

        {globalError ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 mb-6">
            {globalError}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-12 xl:grid-cols-[1.1fr_1fr]">
          <section className="space-y-6">
            <h2 className="text-2xl font-bold">Create Automation Task</h2>
            <form onSubmit={handleSubmit} className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-6 space-y-4 shadow-xl">
              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-1">Target Contract Address</label>
                <input 
                  type="text" 
                  placeholder="C..." 
                  value={taskData.contractAddress}
                  onChange={(e) => setTaskData(prev => ({ ...prev, contractAddress: e.target.value }))}
                  className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm" 
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-1">Function Name</label>
                <input 
                  type="text" 
                  placeholder="harvest_yield" 
                  value={taskData.functionName}
                  onChange={(e) => setTaskData(prev => ({ ...prev, functionName: e.target.value }))}
                  className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm" 
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-400 mb-1">Interval (seconds)</label>
                  <input 
                    type="number" 
                    placeholder="3600" 
                    value={taskData.interval}
                    onChange={(e) => setTaskData(prev => ({ ...prev, interval: e.target.value }))}
                    className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm" 
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-400 mb-1">Gas Balance (XLM)</label>
                  <input 
                    type="number" 
                    placeholder="10" 
                    value={taskData.gasBalance}
                    onChange={(e) => setTaskData(prev => ({ ...prev, gasBalance: e.target.value }))}
                    className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm" 
                  />
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="use-vrf"
                    checked={taskData.useVrf}
                    onChange={(e) => setTaskData(prev => ({ ...prev, useVrf: e.target.checked }))}
                    className="h-4 w-4 text-blue-600 border-neutral-600 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="use-vrf" className="ml-2 block text-sm font-medium text-neutral-400">
                    Use Verifiable Random Function (VRF)
                  </label>
                </div>
                {taskData.useVrf && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-neutral-400 mb-1">VRF Callback Function</label>
                      <input 
                        type="text" 
                        placeholder="fulfillRandomness" 
                        value={taskData.vrfCallbackFunction}
                        onChange={(e) => setTaskData(prev => ({ ...prev, vrfCallbackFunction: e.target.value }))}
                        className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm" 
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral-400 mb-1">VRF Callback Arguments (JSON)</label>
                      <textarea 
                        placeholder='{"randomNumber": "$RANDOM"}'
                        value={taskData.vrfCallbackArgs}
                        onChange={(e) => setTaskData(prev => ({ ...prev, vrfCallbackArgs: e.target.value }))}
                        className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm h-24" 
                      />
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1">Interval (seconds)</label>
                    <input type="number" placeholder="3600" className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm touch-manipulation" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1">Gas Balance (XLM)</label>
                    <input type="number" placeholder="10" className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm touch-manipulation" />
                  </div>
                </div>
                <button className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 rounded-lg transition-colors mt-2 shadow-lg shadow-blue-600/20 touch-manipulation">
                  Register Task
                </button>
              </div>
              
              {/* Natural Language Due Date Input */}
              <DateInput
                value={taskData.dueDate}
                onChange={handleDateChange}
                label="Due Date"
                required={false}
                className="mt-4"
              />
              
              <button 
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 rounded-lg transition-colors mt-2 shadow-lg shadow-blue-600/20"
              >
                Register Task
              </button>
            </form>
          </section>

          <section className="space-y-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-2xl font-bold">Your Tasks</h3>
              <span className="rounded-full border border-neutral-700/70 bg-neutral-950/60 px-3 py-1 text-xs text-neutral-300">
                {tasks.length} total
              </span>
            </div>
            <div className="overflow-hidden rounded-3xl border border-neutral-700/50 bg-neutral-900/80 shadow-xl">
              <table className="min-w-full text-left text-sm text-neutral-200">
                <thead className="border-b border-neutral-800 bg-neutral-950/90 text-neutral-300">
                  <tr>
                    <th className="px-5 py-4">Task</th>
                    <th className="px-5 py-4">Interval</th>
                    <th className="px-5 py-4">Balance</th>
                    <th className="px-5 py-4">Status</th>
                    <th className="px-5 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800 bg-neutral-900">
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-neutral-400">
                        Loading tasks…
                      </td>
                    </tr>
                  ) : tasks.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-neutral-500">
                        No tasks registered yet.
                      </td>
                    </tr>
                  ) : (
                    tasks.map((task, index) => {
                      const status = taskStatus[task.id]
                      const isPending = status?.pending ?? false
                      const errorText = status?.error
                      const isEditing = editingTaskId === task.id

                      return (
                        <tr
                          key={task.id}
                          className={isPending ? 'bg-blue-500/10' : 'hover:bg-neutral-800/50 transition-colors'}
                        >
                          <td className="px-5 py-4">
                            <div className="font-medium text-white">{task.func}</div>
                            <div className="mt-1 text-xs text-neutral-400 font-mono">{task.target}</div>
                          </td>
                          <td className="px-5 py-4">
                            {isEditing ? (
                              <input
                                value={editDraft.interval}
                                onChange={(event) => setEditDraft((current) => ({ ...current, interval: event.target.value }))}
                                type="number"
                                className="w-full rounded-lg border border-neutral-700/70 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                              />
                            ) : (
                              <span className="font-mono text-neutral-300">{task.interval}s</span>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            {isEditing ? (
                              <input
                                value={editDraft.balance}
                                onChange={(event) => setEditDraft((current) => ({ ...current, balance: event.target.value }))}
                                type="number"
                                className="w-full rounded-lg border border-neutral-700/70 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                              />
                            ) : (
                              <span className="font-mono text-neutral-300">{task.balance} XLM</span>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                                isPending
                                  ? 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/25'
                                  : 'bg-green-500/10 text-green-300 ring-1 ring-green-500/25'
                              }`}
                            >
                              {isPending ? 'Pending' : 'Active'}
                            </span>
                            {errorText ? (
                              <div className="mt-2 text-xs text-red-300">{errorText}</div>
                            ) : null}
                          </td>
                          <td className="px-5 py-4 space-y-2">
                            {isEditing ? (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => applyEdit(task)}
                                  disabled={isPending}
                                  className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingTaskId(null)}
                                  className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200 transition hover:border-neutral-500"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => buildDraft(task)}
                                  disabled={isPending}
                                  className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200 transition hover:border-neutral-500"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTask(task.id)}
                                  disabled={isPending}
                                  className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-200 transition hover:bg-red-500/20 disabled:opacity-60"
                                >
                                  Delete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveTask(task.id, -1)}
                                  disabled={isPending || index === 0}
                                  className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200 transition hover:border-neutral-500 disabled:opacity-40"
                                >
                                  Up
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveTask(task.id, 1)}
                                  disabled={isPending || index === tasks.length - 1}
                                  className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200 transition hover:border-neutral-500 disabled:opacity-40"
                                >
                                  Down
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="mt-16 space-y-6">
          <h3 className="text-2xl font-bold">Execution Logs</h3>
          <div className="overflow-hidden rounded-xl border border-neutral-700/50 shadow-xl">
            <table className="w-full text-left text-sm text-neutral-400">
              <thead className="bg-neutral-800 text-neutral-200">
                <tr>
                  <th className="px-6 py-4">Task ID</th>
                  <th className="px-6 py-4">Target</th>
                  <th className="px-6 py-4">Keeper</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Timestamp</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-neutral-800 bg-neutral-900/50">
                <tr className="hover:bg-neutral-800/50 transition-colors">
                  <td className="px-6 py-4 font-mono text-neutral-300">
                    #1024
                  </td>
                  <td className="px-6 py-4 font-mono">CC...A12B</td>
                  <td className="px-6 py-4 font-mono">GA...99X</td>
                  <td className="px-6 py-4">
                    <TransactionStatus status="success" compact />
                  </td>
                  <td className="px-6 py-4">
                    <a href={`${STELLAR_EXPERT_BASE}/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2`}
                      target="_blank" rel="noopener noreferrer"
                      className="font-mono text-blue-400 hover:text-blue-300 underline transition-colors">
                      a1b2c3d4…a1b2
                    </a>
                  </td>
                  <td className="px-6 py-4">2 mins ago</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <button className="p-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-yellow-500 transition-colors border border-neutral-700" title="Pause">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      </button>
                      <button className="p-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-red-500 transition-colors border border-neutral-700" title="Delete">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div ref={logsEndRef} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="edit-interval" className="block text-sm font-medium text-neutral-400 mb-1">
                Interval (seconds)
              </label>
              <input
                id="edit-interval"
                type="number"
                min={1}
                value={form.interval}
                onChange={(event) => setForm({ ...form, interval: event.target.value })}
                required
                className="w-full rounded-2xl border border-neutral-700/80 bg-neutral-900 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label htmlFor="edit-gas" className="block text-sm font-medium text-neutral-400 mb-1">
                Gas Balance (XLM)
              </label>
              <input
                id="edit-gas"
                type="number"
                min={0}
                value={form.gasBalance}
                onChange={(event) => setForm({ ...form, gasBalance: event.target.value })}
                required
                className="w-full rounded-2xl border border-neutral-700/80 bg-neutral-900 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-2xl border border-neutral-700/80 bg-neutral-900 px-4 py-3 text-sm font-medium text-neutral-200 transition hover:border-neutral-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-blue-500"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  onEdit: (task: Task) => void;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}

function TaskCard({ task, onEdit, onToggle, onDelete }: TaskCardProps) {
  const isPaused = task.status === "paused";

  return (
    <article
      aria-label={`Automation task ${task.id}: ${task.functionName} on ${task.contractAddress}`}
      className="rounded-3xl border border-neutral-700/80 bg-neutral-900/70 p-5 shadow-xl shadow-black/20"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">Task #{task.id}</p>
          <p className="font-mono text-sm text-neutral-300 truncate max-w-[18rem]">{task.contractAddress}</p>
          <p className="text-base font-semibold text-neutral-100">{task.functionName}</p>
        </div>
        <span
          role="status"
          aria-label={`Task status: ${task.status}`}
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
            isPaused
              ? "bg-yellow-500/10 text-yellow-300 border border-yellow-500/20"
              : "bg-green-500/10 text-green-300 border border-green-500/20"
          }`}
        >
          {isPaused ? "Paused" : "Active"}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm text-neutral-400">
        <div>
          <dt className="sr-only">Interval</dt>
          <dd>Every {task.interval}s</dd>
        </div>
        <div>
          <dt className="sr-only">Gas balance</dt>
          <dd>{task.gasBalance} XLM</dd>
        </div>
      </dl>

      <div role="group" aria-label={`Actions for task ${task.id}`} className="mt-5 grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => onEdit(task)}
          aria-label={`Edit task ${task.id}`}
          className="rounded-2xl bg-neutral-800 px-3 py-2 text-xs font-medium text-neutral-200 transition hover:bg-neutral-700"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onToggle(task.id)}
          aria-label={isPaused ? `Resume task ${task.id}` : `Pause task ${task.id}`}
          aria-pressed={isPaused}
          className="rounded-2xl bg-neutral-800 px-3 py-2 text-xs font-medium text-neutral-200 transition hover:bg-neutral-700"
        >
          {isPaused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          onClick={() => onDelete(task.id)}
          aria-label={`Delete task ${task.id}`}
          className="rounded-2xl bg-red-600/10 px-3 py-2 text-xs font-medium text-red-300 transition hover:bg-red-600/20"
        >
          Delete
        </button>
      </div>
    </article>
  );
}

function LiveRegion({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  );
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [functionName, setFunctionName] = useState("");
  const [interval, setInterval] = useState("");
  const [gasBalance, setGasBalance] = useState("");
  const [formError, setFormError] = useState("");
  const [criticalWarningAcknowledged, setCriticalWarningAcknowledged] = useState(false);
  const nextTaskId = useRef(1);

  const predictionInput = useMemo(
    () => ({
      contractAddress: contractAddress.trim(),
      functionName: functionName.trim(),
      interval: Number(interval),
      gasBalance: Number(gasBalance),
    }),
    [contractAddress, functionName, interval, gasBalance]
  );

  const analysis = usePredictiveFailureAnalysis(predictionInput);

  const announce = useCallback((message: string) => {
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(message));
  }, []);

  const resetForm = () => {
    setContractAddress("");
    setFunctionName("");
    setInterval("");
    setGasBalance("");
    setFormError("");
    setCriticalWarningAcknowledged(false);
  };

  const handleRegister = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFormError("");

      if (!contractAddress.trim() || !functionName.trim()) {
        setFormError("Contract address and function name are required.");
        return;
      }

      if (Number(interval) < 1) {
        setFormError("Interval must be at least 1 second.");
        return;
      }

      if (Number(gasBalance) < 0) {
        setFormError("Gas balance cannot be negative.");
        return;
      }

      if (analysis.status === "success" && analysis.prediction?.riskLevel === "critical") {
        if (!criticalWarningAcknowledged) {
          setFormError(
            "This configuration is predicted to fail critically. Submit again to register with caution."
          );
          setCriticalWarningAcknowledged(true);
          return;
        }
      }

      const newTask: Task = {
        id: nextTaskId.current++,
        contractAddress: contractAddress.trim(),
        functionName: functionName.trim(),
        interval: Number(interval) || 3600,
        gasBalance: Number(gasBalance) || 10,
        status: "active",
      };

      setTasks((current) => [newTask, ...current]);
      announce(`Task ${newTask.id} registered for ${newTask.functionName}.`);
      resetForm();
    },
    [analysis.prediction?.riskLevel, analysis.status, criticalWarningAcknowledged, contractAddress, functionName, interval, gasBalance, announce]
  );

  const handleSaveEdit = useCallback(
    (updatedTask: Task) => {
      setTasks((current) => current.map((candidate) => (candidate.id === updatedTask.id ? updatedTask : candidate)));
      setEditingTask(null);
      announce(`Task ${updatedTask.id} updated.`);
    },
    [announce]
  );

  const handleToggle = useCallback(
    (taskId: number) => {
      setTasks((current) =>
        current.map((task) =>
          task.id === taskId
            ? { ...task, status: task.status === "active" ? "paused" : "active" }
            : task
        )
      );
      announce(`Task ${taskId} ${tasks.find((task) => task.id === taskId)?.status === "active" ? "paused" : "resumed"}.`);
    },
    [tasks, announce]
  );

  const handleDelete = useCallback(
    (taskId: number) => {
      setTasks((current) => current.filter((task) => task.id !== taskId));
      announce(`Task ${taskId} deleted.`);
    },
    [announce]
  );

  return (
    <>
      <a href="#main-content" className="skip-nav">
        Skip to main content
      </a>

      <LiveRegion message={announcement} />

      {editingTask && (
        <EditTaskDialog
          task={editingTask}
          onSave={handleSaveEdit}
          onClose={() => setEditingTask(null)}
        />
      )}

      <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans">
        <header className="sticky top-0 z-10 border-b border-neutral-800/70 bg-neutral-950/95 backdrop-blur-lg">
          <div className="container mx-auto flex flex-wrap items-center justify-between gap-4 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-500 text-lg font-bold text-white">
                S
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">SoroTask</h1>
                <p className="text-sm text-neutral-400">Predict task failure risk before registration.</p>
              </div>
            </div>
            <button
              id="connect-wallet-btn"
              aria-label="Connect your Stellar wallet"
              className="rounded-2xl bg-neutral-900 px-5 py-3 text-sm font-semibold text-neutral-100 transition hover:bg-neutral-800"
            >
              {isWalletConnected ? `${walletAddress?.slice(0, 6)}...${walletAddress?.slice(-4)}` : "Connect Wallet"}
            </button>
          </div>
        </header>

        <main id="main-content" className="container mx-auto px-6 py-12">
          <div className="grid gap-12 xl:grid-cols-[1.2fr_0.9fr]">
            <section aria-labelledby="create-task-heading" className="space-y-6">
              <div className="space-y-2">
                <p className="text-sm uppercase tracking-[0.24em] text-blue-400">Predictive Execution</p>
                <h2 id="create-task-heading" className="text-3xl font-semibold text-white">
                  Create automation task
                </h2>
              </div>

              <div className="rounded-3xl border border-neutral-800/80 bg-neutral-900/70 p-6 shadow-xl shadow-black/20">
                <form onSubmit={handleRegister} noValidate className="space-y-6" aria-describedby={formError ? "task-form-error" : undefined}>
                  {formError && (
                    <div
                      id="task-form-error"
                      role="alert"
                      className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                    >
                      {formError}
                    </div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <label htmlFor="contract-address" className="block text-sm font-medium text-neutral-400 mb-1">
                        Target Contract Address
                      </label>
                      <input
                        id="contract-address"
                        type="text"
                        value={contractAddress}
                        onChange={(event) => setContractAddress(event.target.value)}
                        placeholder="C..."
                        autoComplete="off"
                        required
                        className="w-full rounded-2xl border border-neutral-700/80 bg-neutral-950 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>

                    <div>
                      <label htmlFor="function-name" className="block text-sm font-medium text-neutral-400 mb-1">
                        Function Name
                      </label>
                      <input
                        id="function-name"
                        type="text"
                        value={functionName}
                        onChange={(event) => setFunctionName(event.target.value)}
                        placeholder="harvest_yield"
                        autoComplete="off"
                        required
                        className="w-full rounded-2xl border border-neutral-700/80 bg-neutral-950 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="interval-seconds" className="block text-sm font-medium text-neutral-400 mb-1">
                          Interval (seconds)
                        </label>
                        <input
                          id="interval-seconds"
                          type="number"
                          min={1}
                          value={interval}
                          onChange={(event) => setInterval(event.target.value)}
                          placeholder="3600"
                          className="w-full rounded-2xl border border-neutral-700/80 bg-neutral-950 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                      <div>
                        <label htmlFor="gas-balance" className="block text-sm font-medium text-neutral-400 mb-1">
                          Gas Balance (XLM)
                        </label>
                        <input
                          id="gas-balance"
                          type="number"
                          min={0}
                          value={gasBalance}
                          onChange={(event) => setGasBalance(event.target.value)}
                          placeholder="10"
                          className="w-full rounded-2xl border border-neutral-700/80 bg-neutral-950 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                    </div>
                  </div>

                  <PredictiveFailureAnalysisPanel
                    status={analysis.status}
                    prediction={analysis.prediction}
                    error={analysis.error}
                  />

                  <button
                    type="submit"
                    className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
                  >
                    Register Task
                  </button>
                </form>
              </div>
            </section>

            <section aria-labelledby="your-tasks-heading" className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 id="your-tasks-heading" className="text-3xl font-semibold text-white">
                    Your tasks
                  </h2>
                  <p className="text-sm text-neutral-400">Tasks are validated before registration and shown in one place.</p>
                </div>
                <span className="rounded-full border border-neutral-700/80 bg-neutral-900/70 px-3 py-2 text-sm text-neutral-300">
                  {tasks.length} total
                </span>
              </div>

              {tasks.length === 0 ? (
                <div aria-live="polite" className="rounded-3xl border border-neutral-800/80 bg-neutral-900/70 p-8 text-center text-neutral-500">
                  <p className="text-base font-medium">No tasks registered yet.</p>
                  <p className="mt-2 text-sm text-neutral-400">Fill the form to see predictive execution warnings before registration.</p>
                </div>
              ) : (
                <ul aria-label="Registered automation tasks" className="space-y-4">
                  {tasks.map((task) => (
                    <li key={task.id}>
                      <TaskCard task={task} onEdit={setEditingTask} onToggle={handleToggle} onDelete={handleDelete} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="mt-16 rounded-3xl border border-neutral-800/80 bg-neutral-900/70 p-6 shadow-xl shadow-black/10">
            <h2 className="text-2xl font-semibold text-white">Execution logs</h2>
            <p className="mt-1 text-sm text-neutral-400">A small example audit trail for simulated task execution outcomes.</p>

            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-left text-sm text-neutral-300">
                <caption className="sr-only">Recent task execution logs.</caption>
                <thead>
                  <tr className="text-xs uppercase tracking-[0.24em] text-neutral-500">
                    <th className="px-4 py-3">Task ID</th>
                    <th className="px-4 py-3">Keeper</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800 border-t border-neutral-800">
                  {MOCK_LOGS.map((entry) => (
                    <tr key={entry.id} className="odd:bg-neutral-950 even:bg-neutral-900">
                      <td className="px-4 py-3 font-mono text-neutral-200">#{entry.taskId}</td>
                      <td className="px-4 py-3 text-neutral-300">{entry.keeper}</td>
                      <td className="px-4 py-3 text-neutral-200">{entry.status}</td>
                      <td className="px-4 py-3 text-neutral-400">{entry.timestamp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}
