import React, { useEffect, useMemo, useState } from "react";
import { Text, useInput } from "ink";
import stripAnsi from "strip-ansi";

type HarnessTextInputProps = {
  value: string;
  placeholder: string;
  focus: boolean;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
};

const graphemeSegmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });

function splitGraphemes(value: string): string[] {
  return Array.from(graphemeSegmenter.segment(value), (segment) => segment.segment);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function splitAtCursor(value: string, cursorOffset: number): { before: string; current: string | undefined; after: string } {
  const graphemes = splitGraphemes(value);
  const boundedOffset = clamp(cursorOffset, 0, graphemes.length);
  return {
    before: graphemes.slice(0, boundedOffset).join(""),
    current: graphemes[boundedOffset],
    after: graphemes.slice(boundedOffset + 1).join(""),
  };
}

function insertAtCursor(value: string, cursorOffset: number, insertedText: string): { value: string; cursorOffset: number } {
  const graphemes = splitGraphemes(value);
  const insertedGraphemes = splitGraphemes(insertedText);
  const boundedOffset = clamp(cursorOffset, 0, graphemes.length);
  const next = [...graphemes.slice(0, boundedOffset), ...insertedGraphemes, ...graphemes.slice(boundedOffset)];
  return {
    value: next.join(""),
    cursorOffset: boundedOffset + insertedGraphemes.length,
  };
}

function deleteBeforeCursor(value: string, cursorOffset: number): { value: string; cursorOffset: number } {
  const graphemes = splitGraphemes(value);
  if (cursorOffset <= 0 || graphemes.length === 0) {
    return { value, cursorOffset: 0 };
  }
  const boundedOffset = clamp(cursorOffset, 0, graphemes.length);
  graphemes.splice(boundedOffset - 1, 1);
  return {
    value: graphemes.join(""),
    cursorOffset: boundedOffset - 1,
  };
}

function deleteAtCursor(value: string, cursorOffset: number): { value: string; cursorOffset: number } {
  const graphemes = splitGraphemes(value);
  const boundedOffset = clamp(cursorOffset, 0, graphemes.length);
  if (boundedOffset >= graphemes.length) {
    return { value, cursorOffset: boundedOffset };
  }
  graphemes.splice(boundedOffset, 1);
  return {
    value: graphemes.join(""),
    cursorOffset: boundedOffset,
  };
}

function normalizeInput(rawInput: string): string {
  return stripAnsi(rawInput)
    .replace(/(?<=[^\\\r\n])\r$/, "")
    .replace(/\r/g, "\n");
}

function consumeBackspaceControlChars(
  rawInput: string,
  value: string,
  cursorOffset: number,
): { value: string; cursorOffset: number; consumed: boolean } {
  const backspaceCount = (rawInput.match(/[\x08\x7f]/g) || []).length;
  if (backspaceCount === 0) {
    return { value, cursorOffset, consumed: false };
  }

  let nextValue = value;
  let nextOffset = cursorOffset;
  for (let index = 0; index < backspaceCount; index += 1) {
    const next = deleteBeforeCursor(nextValue, nextOffset);
    nextValue = next.value;
    nextOffset = next.cursorOffset;
  }

  return {
    value: nextValue,
    cursorOffset: nextOffset,
    consumed: true,
  };
}

export function HarnessTextInput(props: HarnessTextInputProps): React.ReactNode {
  const [cursorOffset, setCursorOffset] = useState(() => splitGraphemes(props.value).length);
  const previousFocusRef = React.useRef(props.focus);

  useEffect(() => {
    const graphemeCount = splitGraphemes(props.value).length;
    setCursorOffset((current) => clamp(current, 0, graphemeCount));
  }, [props.value]);

  useEffect(() => {
    if (props.focus && !previousFocusRef.current) {
      setCursorOffset(splitGraphemes(props.value).length);
    }
    previousFocusRef.current = props.focus;
  }, [props.focus, props.value]);

  useInput(
    (input, key) => {
      if (key.tab || key.escape) {
        return;
      }

      const controlBackspaces = consumeBackspaceControlChars(input, props.value, cursorOffset);
      if (controlBackspaces.consumed) {
        props.onChange(controlBackspaces.value);
        setCursorOffset(controlBackspaces.cursorOffset);
        return;
      }

      if (key.return) {
        props.onSubmit(props.value);
        return;
      }

      if (key.leftArrow) {
        setCursorOffset((current) => clamp(current - 1, 0, splitGraphemes(props.value).length));
        return;
      }

      if (key.rightArrow) {
        setCursorOffset((current) => clamp(current + 1, 0, splitGraphemes(props.value).length));
        return;
      }

      if (key.home || (key.ctrl && input === "a")) {
        setCursorOffset(0);
        return;
      }

      if (key.end || (key.ctrl && input === "e")) {
        setCursorOffset(splitGraphemes(props.value).length);
        return;
      }

      if (key.backspace || (key.ctrl && input === "h")) {
        const next = deleteBeforeCursor(props.value, cursorOffset);
        props.onChange(next.value);
        setCursorOffset(next.cursorOffset);
        return;
      }

      if (key.delete && !key.ctrl && !key.meta && !key.shift) {
        const next = deleteBeforeCursor(props.value, cursorOffset);
        props.onChange(next.value);
        setCursorOffset(next.cursorOffset);
        return;
      }

      if (key.delete || (key.ctrl && input === "d")) {
        const next = deleteAtCursor(props.value, cursorOffset);
        props.onChange(next.value);
        setCursorOffset(next.cursorOffset);
        return;
      }

      if (key.ctrl && input === "u") {
        props.onChange("");
        setCursorOffset(0);
        return;
      }

      if (key.ctrl && input === "b") {
        setCursorOffset((current) => clamp(current - 1, 0, splitGraphemes(props.value).length));
        return;
      }

      if (key.ctrl && input === "f") {
        setCursorOffset((current) => clamp(current + 1, 0, splitGraphemes(props.value).length));
        return;
      }

      const normalizedInput = normalizeInput(input);
      if (!normalizedInput) {
        return;
      }

      const trailingEnter =
        input.length > 1 &&
        input.endsWith("\r") &&
        !input.slice(0, -1).includes("\r") &&
        input[input.length - 2] !== "\\";

      const next = insertAtCursor(props.value, cursorOffset, normalizedInput);
      props.onChange(next.value);
      setCursorOffset(next.cursorOffset);

      if (trailingEnter) {
        props.onSubmit(next.value);
      }
    },
    { isActive: props.focus },
  );

  const rendered = useMemo(() => {
    if (!props.focus) {
      return props.value || props.placeholder;
    }
    if (!props.value) {
      return (
        <Text color="gray">
          <Text inverse> </Text>
          {props.placeholder}
        </Text>
      );
    }
    const { before, current, after } = splitAtCursor(props.value, cursorOffset);
    return (
      <>
        {before}
        <Text inverse>{current ?? " "}</Text>
        {after}
      </>
    );
  }, [cursorOffset, props.focus, props.placeholder, props.value]);

  if (!props.focus && !props.value) {
    return <Text color="gray">{props.placeholder}</Text>;
  }

  return <Text wrap="truncate-end">{rendered}</Text>;
}
