"use client";

type MicButtonProps = {
  isListening: boolean;
  isBusy?: boolean;
  onToggle: () => void;
};

export function MicButton({ isListening, isBusy = false, onToggle }: MicButtonProps) {
  const disabled = isBusy;

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={[
        "relative inline-flex min-w-40 items-center justify-center rounded-lg px-4 py-2 font-medium transition",
        disabled ? "cursor-not-allowed bg-slate-700 text-slate-300" : "",
        !disabled && isListening ? "bg-rose-600 text-white hover:bg-rose-500" : "",
        !disabled && !isListening ? "bg-emerald-600 text-white hover:bg-emerald-500" : "",
      ].join(" ")}
    >
      {isListening ? "Stop Listening" : "Start Listening"}
      {isListening ? (
        <span className="ml-2 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
      ) : null}
    </button>
  );
}
