import { Show, onMount, createSignal } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { Workspace } from "./components/Workspace";
import { TopBar } from "./components/TopBar";
import { projectState, addProject, initializeProjects } from "./store/project";
import "./App.css";

function App() {
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    // Load persisted state first
    await initializeProjects();
    setLoading(false);
    
    // Show folder picker on launch if no projects
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
        <h1 class="project-picker__title">Raven</h1>
        <p class="project-picker__subtitle">Open a project to get started</p>
        <button class="project-picker__button" onClick={handleOpen}>
          Open Folder
        </button>
      </div>
    </div>
  );
}

export default App;
