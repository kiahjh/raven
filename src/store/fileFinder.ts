/**
 * Store for managing file finder state.
 */

import { createSignal } from "solid-js";

const [isOpen, setIsOpen] = createSignal(false);

export const fileFinderState = {
  get isOpen() {
    return isOpen();
  },
};

export function openFileFinder() {
  setIsOpen(true);
}

export function closeFileFinder() {
  setIsOpen(false);
}
