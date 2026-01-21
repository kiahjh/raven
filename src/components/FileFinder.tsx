import { createSignal, createEffect, For, Show, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { fuzzyFilter, FuzzyMatch } from "../utils/fuzzy";
import "./FileFinder.css";

interface Props {
  projectPath: string;
  onSelect: (filePath: string) => void;
  onCancel: () => void;
}

export function FileFinder(props: Props) {
  let inputRef: HTMLInputElement | undefined;
  
  const [query, setQuery] = createSignal("");
  const [files, setFiles] = createSignal<string[]>([]);
  const [filtered, setFiltered] = createSignal<FuzzyMatch[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  // Load files on mount
  onMount(async () => {
    try {
      const fileList = await invoke<string[]>("list_files", { root: props.projectPath });
      setFiles(fileList);
      setFiltered(fuzzyFilter("", fileList));
    } catch (e) {
      setError(`Failed to load files: ${e}`);
    } finally {
      setLoading(false);
    }

    // Focus input
    inputRef?.focus();
  });

  // Update filtered list when query changes
  createEffect(() => {
    const q = query();
    const f = files();
    if (f.length > 0) {
      const matches = fuzzyFilter(q, f);
      setFiltered(matches.slice(0, 100)); // Limit to 100 results for performance
      setSelectedIndex(0);
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    const items = filtered();

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (items.length > 0) {
          const selected = items[selectedIndex()];
          const fullPath = `${props.projectPath}/${selected.path}`;
          props.onSelect(fullPath);
        }
        break;
      case "Escape":
        e.preventDefault();
        props.onCancel();
        break;
    }
  };

  // Scroll selected item into view
  createEffect(() => {
    const index = selectedIndex();
    const element = document.querySelector(`[data-finder-index="${index}"]`);
    element?.scrollIntoView({ block: "nearest" });
  });

  return (
    <div class="file-finder__overlay" onClick={() => props.onCancel()}>
      <div class="file-finder" onClick={(e) => e.stopPropagation()}>
        <div class="file-finder__input-wrapper">
          <input
            ref={inputRef}
            type="text"
            class="file-finder__input"
            placeholder="Search files..."
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        
        <Show when={loading()}>
          <div class="file-finder__loading">Loading files...</div>
        </Show>
        
        <Show when={error()}>
          <div class="file-finder__error">{error()}</div>
        </Show>
        
        <Show when={!loading() && !error()}>
          <div class="file-finder__results">
            <Show when={filtered().length === 0}>
              <div class="file-finder__empty">No files found</div>
            </Show>
            <For each={filtered()}>
              {(match, index) => (
                <div
                  class="file-finder__item"
                  classList={{ "file-finder__item--selected": index() === selectedIndex() }}
                  data-finder-index={index()}
                  onClick={() => {
                    const fullPath = `${props.projectPath}/${match.path}`;
                    props.onSelect(fullPath);
                  }}
                  onMouseEnter={() => setSelectedIndex(index())}
                >
                  <HighlightedPath path={match.path} matches={match.matches} />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

interface HighlightedPathProps {
  path: string;
  matches: number[];
}

function HighlightedPath(props: HighlightedPathProps) {
  const matchSet = () => new Set(props.matches);

  return (
    <span class="file-finder__path">
      <For each={props.path.split("")}>
        {(char, index) => (
          <span classList={{ "file-finder__match": matchSet().has(index()) }}>
            {char}
          </span>
        )}
      </For>
    </span>
  );
}
