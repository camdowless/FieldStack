import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink } from "lucide-react";

interface Props {
  show: boolean;
  message?: string;
  destination?: string;
}

export function RedirectingOverlay({
  show,
  message = "Redirecting you to Stripe",
  destination = "secure checkout",
}: Props) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm"
        >
          {/* Animated ring */}
          <div className="relative mb-8">
            {/* Outer pulse ring */}
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-primary/30"
              animate={{ scale: [1, 1.6, 1.6], opacity: [0.6, 0, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
            />
            {/* Middle pulse ring */}
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-primary/20"
              animate={{ scale: [1, 1.35, 1.35], opacity: [0.5, 0, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut", delay: 0.3 }}
            />
            {/* Icon container */}
            <motion.div
              className="relative w-20 h-20 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center"
              animate={{ scale: [1, 1.04, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            >
              <ExternalLink className="h-8 w-8 text-primary" />
            </motion.div>
          </div>

          {/* Text */}
          <motion.p
            className="text-lg font-semibold text-foreground mb-1"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            {message}
          </motion.p>
          <motion.p
            className="text-sm text-muted-foreground"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            Taking you to {destination}…
          </motion.p>

          {/* Animated dots */}
          <motion.div
            className="flex gap-1.5 mt-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-primary"
                animate={{ opacity: [0.3, 1, 0.3], y: [0, -4, 0] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18 }}
              />
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
