type MailMindRobotProps = {
  state?: "idle" | "thinking" | "speaking" | "locked";
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeMap = {
  sm: 36,
  md: 52,
  lg: 80,
};

export function MailMindRobot({
  state = "idle",
  size = "sm",
  className = "",
}: MailMindRobotProps) {
  const dimension = sizeMap[size];

  return (
    <div
      className={`mailmind-robot mailmind-robot--${state} shrink-0 ${className}`}
      style={{ width: dimension, height: dimension }}
      aria-hidden
    >
      <svg
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-full"
      >
        <defs>
          <linearGradient id="robot-body" x1="12" y1="8" x2="52" y2="56">
            <stop stopColor="#818cf8" />
            <stop offset="1" stopColor="#6d28d9" />
          </linearGradient>
          <linearGradient id="robot-face" x1="20" y1="18" x2="44" y2="42">
            <stop stopColor="#312e81" />
            <stop offset="1" stopColor="#1e1b4b" />
          </linearGradient>
        </defs>

        <ellipse
          className="robot-glow"
          cx="32"
          cy="34"
          rx="24"
          ry="22"
          fill="url(#robot-body)"
          opacity="0.25"
        />

        <rect
          x="14"
          y="18"
          width="36"
          height="32"
          rx="12"
          fill="url(#robot-body)"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="1.5"
        />

        <rect
          x="20"
          y="24"
          width="24"
          height="18"
          rx="8"
          fill="url(#robot-face)"
        />

        <line
          className="robot-antenna"
          x1="32"
          y1="18"
          x2="32"
          y2="8"
          stroke="#c4b5fd"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle className="robot-antenna-tip" cx="32" cy="6" r="4" fill="#22d3ee" />

        <circle className="robot-eye robot-eye-left" cx="26" cy="32" r="3.5" fill="#67e8f9" />
        <circle className="robot-eye robot-eye-right" cx="38" cy="32" r="3.5" fill="#67e8f9" />
        <circle className="robot-pupil robot-pupil-left" cx="26" cy="32" r="1.5" fill="#0f172a" />
        <circle className="robot-pupil robot-pupil-right" cx="38" cy="32" r="1.5" fill="#0f172a" />

        <path
          className="robot-mouth"
          d="M 26 40 Q 32 44 38 40"
          stroke="#a5b4fc"
          strokeWidth="2"
          strokeLinecap="round"
        />

        <rect x="10" y="28" width="6" height="12" rx="3" fill="#6366f1" opacity="0.9" />
        <rect x="48" y="28" width="6" height="12" rx="3" fill="#6366f1" opacity="0.9" />

        <rect x="22" y="50" width="8" height="6" rx="2" fill="#4f46e5" />
        <rect x="34" y="50" width="8" height="6" rx="2" fill="#4f46e5" />
      </svg>
    </div>
  );
}
