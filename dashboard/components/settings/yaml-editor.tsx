"use client";

import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";

export function YamlEditor({
  value,
  onChange,
  height = "560px",
}: {
  value: string;
  onChange: (value: string) => void;
  height?: string;
}) {
  return (
    <CodeMirror
      value={value}
      height={height}
      extensions={[yaml()]}
      onChange={onChange}
    />
  );
}
