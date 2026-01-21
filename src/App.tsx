import { Show, onMount, createSignal } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { WindowChrome } from "./components/WindowChrome";
import { Workspace } from "./components/Workspace";
import { TopBar } from "./components/TopBar";
import { projectState, addProject, initializeProjects } from "./store/project";
import "./App.css";

function App() {
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    await initializeProjects();
    setLoading(false);
    
    if (projectState.all.length === 0) {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Open Project",
      });
      
      if (selected && typeof selected === "string") {
        await addProject(selected);
      }
    }
  });

  const handleAddProject = async (path: string) => {
    await addProject(path);
  };

  return (
    <WindowChrome>
      <Show when={!loading()} fallback={<div class="loading" />}>
        <Show 
          when={projectState.current} 
          fallback={<ProjectPicker />}
        >
          <div class="app">
            <TopBar projects={projectState.all} onAddProject={handleAddProject} />
            <div class="app__workspace">
              <Workspace />
            </div>
          </div>
        </Show>
      </Show>
    </WindowChrome>
  );
}

function ProjectPicker() {
  const handleOpen = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open Project",
    });
    
    if (selected && typeof selected === "string") {
      addProject(selected);
    }
  };

  return (
    <div class="project-picker">
      <div class="project-picker__content">
        {/* Abstract raven mark */}
        <div class="project-picker__mark">
          <svg viewBox="0 0 48 48" fill="none">
            <path 
              d="M24 8C16 8 10 16 10 24c0 5 2.5 9.5 6.5 12.5L14 44l6-3 4 4 4-4 6 3-2.5-7.5C35.5 33.5 38 29 38 24c0-8-6-16-14-16z"
              fill="currentColor"
              opacity="0.9"
            />
            <circle cx="19" cy="22" r="2.5" fill="var(--depth-2)"/>
            <circle cx="29" cy="22" r="2.5" fill="var(--depth-2)"/>
          </svg>
        </div>
        
        <div class="project-picker__text">
          <h1 class="project-picker__title">Raven</h1>
          <p class="project-picker__subtitle">
            Your focused workspace
          </p>
        </div>
        
        <button class="project-picker__button" onClick={handleOpen}>
          <svg class="project-picker__button-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M2 4.75A2.75 2.75 0 014.75 2h4.568a2.75 2.75 0 011.944.805l1.073 1.073a.25.25 0 00.177.072h2.738A2.75 2.75 0 0118 6.7v8.55A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25V4.75zm8.47 4.72a.75.75 0 011.06 0l2 2a.75.75 0 01-1.06 1.06l-.72-.72v2.44a.75.75 0 01-1.5 0v-2.44l-.72.72a.75.75 0 01-1.06-1.06l2-2z" clip-rule="evenodd"/>
          </svg>
          Open Folder
        </button>
        
        <div class="project-picker__hint">
          Press <kbd>Cmd</kbd> <kbd>O</kbd> to open
        </div>
      </div>
    </div>
  );
}

export default App;
