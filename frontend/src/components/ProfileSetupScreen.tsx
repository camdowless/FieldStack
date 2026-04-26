import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const STEPS = [
  { id: 1, label: "Creating your account",     icon: "✦",  duration: 1800 },
  { id: 2, label: "Setting up your profile",   icon: "◈",  duration: 2200 },
  { id: 3, label: "Configuring your workspace",icon: "⬡",  duration: 2000 },
  { id: 4, label: "Almost ready",              icon: "◎",  duration: 99999 },
];

function StepRow({ label, icon, state }: { label: string; icon: string; state: "pending" | "active" | "done" }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: state === "pending" ? 0.35 : 1, x: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex items-center gap-3"
    >
      {/* Icon / check */}
      <div className="relative w-7 h-7 flex items-center justify-center shrink-0">
        <AnimatePresence mode="wait">
          {state === "done" ? (
            <motion.div
              key="check"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              className="w-7 h-7 rounded-full bg-primary flex items-center justify-center"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2.5 7L5.5 10L11.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.div>
          ) : state === "active" ? (
            <motion.div
              key="spinner"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              className="w-7 h-7 rounded-full border-2 border-primary/20 border-t-primary animate-spin"
            />
          ) : (
            <motion.div
              key="dot"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-2 h-2 rounded-full bg-muted-foreground/30 mx-auto"
            />
          )}
        </AnimatePresence>
      </div>

      {/* Label */}
      <span
        className={`text-sm font-medium transition-colors duration-300 ${
          state === "done"
            ? "text-foreground"
            : state === "active"
              ? "text-foreground"
              : "text-muted-foreground/50"
        }`}
      >
        {label}
      </span>

      {/* "Done" badge */}
      <AnimatePresence>
        {state === "done" && (
          <motion.span
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="ml-auto text-xs text-primary font-semibold"
          >
            Done
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function ProfileSetupScreen() {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    let i = 0;
    function advance() {
      i++;
      if (i < STEPS.length) {
        setActiveStep(i);
        const next = STEPS[i];
        if (next.duration < 99999) {
          setTimeout(advance, next.duration);
        }
      }
    }
    const t = setTimeout(advance, STEPS[0].duration);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background overflow-hidden">
      {/* Ambient glow blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.18, 0.28, 0.18] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-primary/20 blur-[120px]"
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.12, 0.22, 0.12] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          className="absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full bg-violet-500/15 blur-[120px]"
        />
      </div>

      <div className="relative z-10 w-full max-w-sm px-6">
        {/* Logo / brand mark */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="flex justify-center mb-10"
        >
          <div className="relative">
            {/* Outer pulse ring */}
            <motion.div
              animate={{ scale: [1, 1.35, 1], opacity: [0.4, 0, 0.4] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
              className="absolute inset-0 rounded-2xl bg-primary/30"
            />
            <div className="relative w-16 h-16 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
              <motion.svg
                width="32" height="32" viewBox="0 0 32 32" fill="none"
                animate={{ rotate: [0, 5, -5, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              >
                <circle cx="16" cy="16" r="6" fill="white" fillOpacity="0.9" />
                <circle cx="16" cy="16" r="11" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" />
                <circle cx="16" cy="16" r="15" stroke="white" strokeOpacity="0.15" strokeWidth="1" />
              </motion.svg>
            </div>
          </div>
        </motion.div>

        {/* Headline */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-center mb-8"
        >
          <h1 className="text-2xl font-bold tracking-tight mb-1.5">Welcome aboard</h1>
          <p className="text-sm text-muted-foreground">
            We're getting everything ready for you.
          </p>
        </motion.div>

        {/* Steps card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 }}
          className="rounded-2xl border bg-card/60 backdrop-blur-sm shadow-xl shadow-black/5 p-6 flex flex-col gap-4"
        >
          {STEPS.map((step, idx) => (
            <StepRow
              key={step.id}
              label={step.label}
              icon={step.icon}
              state={idx < activeStep ? "done" : idx === activeStep ? "active" : "pending"}
            />
          ))}
        </motion.div>

        {/* Progress bar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-6 h-1 rounded-full bg-muted overflow-hidden"
        >
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={{ width: "5%" }}
            animate={{ width: `${Math.round(((activeStep + 1) / STEPS.length) * 100)}%` }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
          />
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-center text-xs text-muted-foreground mt-3"
        >
          This only takes a moment…
        </motion.p>
      </div>
    </div>
  );
}
