"use client";

import { FormEvent, useCallback, useMemo, useRef, useState } from "react";
import PredictiveFailureAnalysisPanel from "./components/PredictiveFailureAnalysisPanel";
import usePredictiveFailureAnalysis from "./hooks/usePredictiveFailureAnalysis";

interface Task {
  id: number;
  contractAddress: string;
  functionName: string;
  interval: number;
  gasBalance: number;
  status: "active" | "paused";
}

interface LogEntry {
  id: number;
  taskId: number;
  keeper: string;
  status: "success" | "failed" | "pending";
  timestamp: string;
}

const MOCK_LOGS: LogEntry[] = [
  {
    id: 1,
    taskId: 1,
    keeper: "GB6...X76",
    status: "success",
    timestamp: "2 minutes ago",
  },
  {
    id: 2,
    taskId: 2,
    keeper: "GC9...Y42",
    status: "failed",
    timestamp: "5 minutes ago",
  },
];

interface EditTaskDialogProps {
  task: Task;
  onSave: (updated: Task) => void;
  onClose: () => void;
}

function EditTaskDialog({ task, onSave, onClose }: EditTaskDialogProps) {
  const [form, setForm] = useState({
    contractAddress: task.contractAddress,
    functionName: task.functionName,
    interval: String(task.interval),
    gasBalance: String(task.gasBalance),
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
            <label htmlFor="edit-function" className="block text-sm font-medium text-neutral-400 mb-1">
              Function Name
            </label>
            <input
              id="edit-function"
              type="text"
              value={form.functionName}
              onChange={(event) => setForm({ ...form, functionName: event.target.value })}
              required
              autoComplete="off"
              className="w-full rounded-2xl border border-neutral-700/80 bg-neutral-900 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
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
