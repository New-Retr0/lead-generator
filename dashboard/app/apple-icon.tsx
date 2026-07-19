import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1a1a1a",
          color: "#f97316",
          fontSize: 96,
          fontWeight: 700,
          fontFamily: "ui-monospace, monospace",
          borderRadius: 36,
        }}
      >
        P
      </div>
    ),
    { ...size },
  );
}
