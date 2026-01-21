import { For } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { projectState, setCurrentProject, Project } from "../store/project";
import "./TopBar.css";

interface Props {
  projects: Project[];
  onAddProject: (path: string) => Promise<void>;
}

export function TopBar(props: Props) {
  const handleAddProject = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open Project",
    });
    
    if (selected && typeof selected === "string") {
      await props.onAddProject(selected);
    }
  };

  const handleSwitchProject = async (path: string) => {
    await setCurrentProject(path);
  };

  return (
    <div class="top-bar">
      <div class="top-bar__projects">
        <For each={props.projects}>
          {(project) => (
            <button
              class="top-bar__project"
              classList={{ "top-bar__project--active": projectState.current?.path === project.path }}
              onClick={() => handleSwitchProject(project.path)}
            >
              {project.name}
            </button>
          )}
        </For>
        <button class="top-bar__add" onClick={handleAddProject} title="Open project">
          +
        </button>
      </div>
    </div>
  );
}
