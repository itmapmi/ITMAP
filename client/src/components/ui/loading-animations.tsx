import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function LoadingSpinner({ size = "md", className }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-8 h-8", 
    lg: "w-12 h-12"
  };

  return (
    <motion.div
      className={cn("relative", sizeClasses[size], className)}
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
    >
      <div className="absolute inset-0 rounded-full border-2 border-gray-200"></div>
      <div className="absolute inset-0 rounded-full border-2 border-blue-600 border-t-transparent"></div>
    </motion.div>
  );
}

interface PulsingDotsProps {
  className?: string;
}

export function PulsingDots({ className }: PulsingDotsProps) {
  return (
    <div className={cn("flex space-x-1", className)}>
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-2 h-2 bg-blue-600 rounded-full"
          animate={{ scale: [1, 1.5, 1] }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            delay: i * 0.2,
            ease: "easeInOut"
          }}
        />
      ))}
    </div>
  );
}

interface SkeletonCardProps {
  className?: string;
  showAvatar?: boolean;
  lines?: number;
}

export function SkeletonCard({ className, showAvatar = false, lines = 3 }: SkeletonCardProps) {
  return (
    <motion.div
      className={cn("p-6 bg-white rounded-lg border shadow-sm", className)}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-start space-x-4">
        {showAvatar && (
          <motion.div
            className="w-12 h-12 bg-gray-200 rounded-full"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        )}
        <div className="flex-1 space-y-3">
          <motion.div
            className="h-4 bg-gray-200 rounded"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            style={{ width: "75%" }}
          />
          {Array.from({ length: lines }).map((_, i) => (
            <motion.div
              key={i}
              className="h-3 bg-gray-200 rounded"
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.1 }}
              style={{ width: i === lines - 1 ? "50%" : "100%" }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

interface LoadingGridProps {
  columns?: number;
  rows?: number;
  className?: string;
}

export function LoadingGrid({ columns = 3, rows = 2, className }: LoadingGridProps) {
  return (
    <div className={cn("grid gap-6", className)} style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {Array.from({ length: columns * rows }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: i * 0.1 }}
        >
          <SkeletonCard />
        </motion.div>
      ))}
    </div>
  );
}

interface WaveLoadingProps {
  className?: string;
}

export function WaveLoading({ className }: WaveLoadingProps) {
  return (
    <div className={cn("flex items-center justify-center space-x-1", className)}>
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.div
          key={i}
          className="w-1 bg-blue-600 rounded-full"
          animate={{ height: ["20px", "40px", "20px"] }}
          transition={{
            duration: 1,
            repeat: Infinity,
            delay: i * 0.1,
            ease: "easeInOut"
          }}
        />
      ))}
    </div>
  );
}

interface ChartLoadingProps {
  className?: string;
}

export function ChartLoading({ className }: ChartLoadingProps) {
  return (
    <motion.div
      className={cn("w-full h-64 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center", className)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <div className="text-center">
        <motion.div
          className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-blue-400 to-purple-500 rounded-lg"
          animate={{ 
            scale: [1, 1.1, 1],
            rotate: [0, 180, 360]
          }}
          transition={{ 
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
        <p className="text-gray-500 text-sm">Loading chart data...</p>
        <PulsingDots className="justify-center mt-2" />
      </div>
    </motion.div>
  );
}

interface LoadingOverlayProps {
  isVisible: boolean;
  message?: string;
  className?: string;
}

export function LoadingOverlay({ isVisible, message = "Loading...", className }: LoadingOverlayProps) {
  if (!isVisible) return null;

  return (
    <motion.div
      className={cn("fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50", className)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="bg-white rounded-lg p-8 text-center shadow-xl"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ duration: 0.3, type: "spring" }}
      >
        <LoadingSpinner size="lg" className="mx-auto mb-4" />
        <p className="text-gray-700 font-medium">{message}</p>
      </motion.div>
    </motion.div>
  );
}

interface ProgressBarProps {
  progress: number;
  className?: string;
  animated?: boolean;
}

export function ProgressBar({ progress, className, animated = true }: ProgressBarProps) {
  return (
    <div className={cn("w-full bg-gray-200 rounded-full h-2", className)}>
      <motion.div
        className="bg-gradient-to-r from-blue-500 to-purple-600 h-2 rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        transition={{ duration: animated ? 0.5 : 0, ease: "easeOut" }}
      />
    </div>
  );
}