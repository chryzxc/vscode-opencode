import { useCallback, useState } from "react";

const modalOpenByKey = new Map<string, boolean>();

/**
 * Keeps a timeline modal open when streamed events recreate its owning card.
 * A normal close still clears the remembered state immediately.
 */
export function usePersistentModalOpen(key: string): [boolean, (open: boolean) => void] {
  const [isOpen, setIsOpen] = useState(() => modalOpenByKey.get(key) === true);

  const setOpen = useCallback((open: boolean) => {
    modalOpenByKey.set(key, open);
    setIsOpen(open);
  }, [key]);

  return [isOpen, setOpen];
}
