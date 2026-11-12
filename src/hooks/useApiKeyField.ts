import { type ChangeEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";

interface ApiKeyFieldOptions {
  load: () => Promise<string | null>;
  save: (key: string) => Promise<void>;
  onSaved?: () => Promise<void> | void;
}

const VISIBLE_KEY_ENDS = 4;

function maskKey(key: string): string {
  if (key.length <= VISIBLE_KEY_ENDS * 2) return key;
  return `${key.slice(0, VISIBLE_KEY_ENDS)}••••••••${key.slice(-VISIBLE_KEY_ENDS)}`;
}

/** A secret key input that saves once the user is done with it (blur, Enter, or the field going away),
 * never per keystroke, and one save at a time so an older key can't land last. */
export function useApiKeyField({ load, save, onSaved }: ApiKeyFieldOptions) {
  const [value, setValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const valueRef = useRef("");
  const savedRef = useRef("");
  const hasEditedRef = useRef(false);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  // Held in a ref so the unmount commit uses the latest callbacks without re-arming the effect.
  const callbacksRef = useRef({ save, onSaved });
  callbacksRef.current = { save, onSaved };

  function commit() {
    const key = valueRef.current;
    if (key === savedRef.current) return;
    const previous = savedRef.current;
    savedRef.current = key;
    saveChainRef.current = saveChainRef.current.then(async () => {
      try {
        await callbacksRef.current.save(key);
        await callbacksRef.current.onSaved?.();
      } catch (err) {
        if (savedRef.current === key) savedRef.current = previous;
        console.error("Saving API key failed:", err);
      }
    });
  }

  // Load once per mount; `load` is read once on purpose so a new function identity doesn't reload over typing.
  useEffect(() => {
    let isCancelled = false;
    load()
      .then((key) => {
        if (isCancelled || hasEditedRef.current || !key) return;
        valueRef.current = key;
        savedRef.current = key;
        setValue(key);
      })
      .catch(() => {});
    return () => {
      isCancelled = true;
    };
  }, []);

  // Empty deps: commit reads only refs, so this runs once, when the field goes away.
  useEffect(() => () => commit(), []);

  return {
    inputProps: {
      value: isFocused ? value : maskKey(value),
      onFocus: () => setIsFocused(true),
      onBlur: () => {
        setIsFocused(false);
        commit();
      },
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        hasEditedRef.current = true;
        valueRef.current = event.target.value;
        setValue(event.target.value);
      },
      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") commit();
      },
    },
  };
}
