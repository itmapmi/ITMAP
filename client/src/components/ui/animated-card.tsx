import { motion, MotionProps } from "framer-motion";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AnimatedCardProps extends MotionProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  stagger?: boolean;
  delay?: number;
}

export function AnimatedCard({ 
  children, 
  className, 
  hover = true, 
  stagger = false,
  delay = 0,
  ...motionProps 
}: AnimatedCardProps) {
  const defaultVariants = {
    hidden: { 
      opacity: 0, 
      y: 20,
      scale: 0.95
    },
    visible: { 
      opacity: 1, 
      y: 0,
      scale: 1,
      transition: {
        duration: 0.4,
        delay: stagger ? delay : 0,
        ease: [0.25, 0.25, 0, 1]
      }
    }
  };

  const allVariants = {
    ...defaultVariants,
    ...(hover && {
      hover: {
        y: -4,
        scale: 1.02,
        boxShadow: "0 10px 25px rgba(0, 0, 0, 0.1)",
        transition: {
          duration: 0.2,
          ease: "easeOut"
        }
      }
    })
  };

  return (
    <motion.div
      className={cn(
        "bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden",
        "transition-shadow duration-200",
        className
      )}
      variants={allVariants}
      initial="hidden"
      animate="visible"
      whileHover={hover ? "hover" : undefined}
      {...motionProps}
    >
      {children}
    </motion.div>
  );
}

interface StaggeredGridProps {
  children: ReactNode[];
  className?: string;
  columns?: number;
  staggerDelay?: number;
}

export function StaggeredGrid({ 
  children, 
  className, 
  columns = 3, 
  staggerDelay = 0.1 
}: StaggeredGridProps) {
  return (
    <div 
      className={cn("grid gap-6", className)}
      style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
    >
      {children.map((child, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ 
            duration: 0.4,
            delay: index * staggerDelay,
            ease: [0.25, 0.25, 0, 1]
          }}
        >
          {child}
        </motion.div>
      ))}
    </div>
  );
}

interface FadeInSectionProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  direction?: "up" | "down" | "left" | "right";
}

export function FadeInSection({ 
  children, 
  className, 
  delay = 0,
  direction = "up"
}: FadeInSectionProps) {
  const directions = {
    up: { y: 30 },
    down: { y: -30 },
    left: { x: 30 },
    right: { x: -30 }
  };

  return (
    <motion.div
      className={className}
      initial={{ 
        opacity: 0, 
        ...directions[direction]
      }}
      animate={{ 
        opacity: 1, 
        x: 0, 
        y: 0 
      }}
      transition={{ 
        duration: 0.6,
        delay,
        ease: [0.25, 0.25, 0, 1]
      }}
    >
      {children}
    </motion.div>
  );
}