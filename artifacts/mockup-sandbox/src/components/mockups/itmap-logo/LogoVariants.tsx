export function LogoVariants() {
  const variants = [
    {
      name: "Bold Navy",
      style: {
        fontFamily: "'Montserrat', sans-serif",
        fontWeight: 800,
        fontSize: "96px",
        letterSpacing: "-0.03em",
        color: "#0f172a",
      },
      label: "Strong, confident, enterprise-grade",
      bg: "#f8fafc",
    },
    {
      name: "Gradient Tech",
      style: {
        fontFamily: "'Montserrat', sans-serif",
        fontWeight: 800,
        fontSize: "96px",
        letterSpacing: "-0.02em",
        background: "linear-gradient(90deg, #06b6d4, #7c3aed)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
      },
      label: "Modern, AI-forward, energetic",
      bg: "#ffffff",
    },
    {
      name: "Elegant Wide",
      style: {
        fontFamily: "'Montserrat', sans-serif",
        fontWeight: 400,
        fontSize: "84px",
        letterSpacing: "0.22em",
        color: "#334155",
        textTransform: "uppercase" as const,
      },
      label: "Spacious, premium, editorial",
      bg: "#f8fafc",
    },
    {
      name: "Badge Black",
      style: {
        fontFamily: "'Montserrat', sans-serif",
        fontWeight: 900,
        fontSize: "80px",
        letterSpacing: "0.04em",
        color: "#ffffff",
      },
      label: "Punchy, iconic, high-contrast",
      bg: "#0f172a",
    },
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "64px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "48px",
        background: "#e2e8f0",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {variants.map((v) => (
        <div
          key={v.name}
          style={{
            background: v.bg,
            borderRadius: "24px",
            padding: "48px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 20px 40px -12px rgba(15, 23, 42, 0.12)",
            minHeight: "280px",
          }}
        >
          <div style={{ marginBottom: "24px" }}>
            {v.name === "Badge Black" ? (
              <span
                style={{
                  display: "inline-block",
                  padding: "16px 40px",
                  borderRadius: "999px",
                  background: "#0f172a",
                }}
              >
                <span style={v.style}>ITMAP</span>
              </span>
            ) : (
              <span style={v.style}>ITMAP</span>
            )}
          </div>
          <div
            style={{
              fontSize: "14px",
              fontWeight: 600,
              color: "#64748b",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: "8px",
            }}
          >
            {v.name}
          </div>
          <div style={{ fontSize: "14px", color: "#94a3b8" }}>{v.label}</div>
        </div>
      ))}
    </div>
  );
}

export default LogoVariants;
