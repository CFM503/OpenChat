import { useState, useCallback } from 'react';
import type { WorkspaceFile } from '../core/types';
import { backendClient } from '../services/api';
import { uid } from '../lib/uid';

const DEFAULT_FILES: WorkspaceFile[] = [
  {
    id: 'file_default_1',
    name: 'main.py',
    language: 'python',
    content: `# OpenChat Workspace — main.py\n# Start coding or ask the AI assistant!\n\ndef hello():\n    print("Welcome to OpenChat!")\n\nif __name__ == "__main__":\n    hello()\n`,
    lastModified: Date.now(),
  },
  {
    id: 'file_default_2',
    name: 'utils.ts',
    language: 'typescript',
    content: `// Utility functions\n\nexport function formatTimestamp(ts: number): string {\n  return new Date(ts).toLocaleTimeString();\n}\n`,
    lastModified: Date.now(),
  },
];

export function useWorkspace() {
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>(DEFAULT_FILES);
  const [activeFileId, setActiveFileId] = useState<string>(DEFAULT_FILES[0].id);
  const [rightPanelTab, setRightPanelTab] = useState<'code' | 'tasks'>('code');

  const handleFileChange = useCallback((id: string, content: string) => {
    setWorkspaceFiles(prev =>
      prev.map(f => (f.id === id ? { ...f, content, lastModified: Date.now(), dirty: true } : f)),
    );
  }, []);

  const handleAddFile = useCallback((name: string, language: string) => {
    const newFile: WorkspaceFile = {
      id: uid('file'),
      name,
      language,
      content: `// ${name}\n`,
      lastModified: Date.now(),
      dirty: true,
    };
    setWorkspaceFiles(prev => [...prev, newFile]);
    setActiveFileId(newFile.id);
  }, []);

  const handleCloseFile = useCallback((id: string) => {
    setWorkspaceFiles(prev => {
      const next = prev.filter(f => f.id !== id);
      setActiveFileId(curr => {
        if (curr !== id) return curr;
        return next.length > 0 ? next[next.length - 1].id : '';
      });
      return next;
    });
  }, []);

  const handleSaveFile = useCallback(
    async (id: string) => {
      const file = workspaceFiles.find(f => f.id === id);
      if (!file) return;
      const targetPath = file.filePath || file.name;
      try {
        await backendClient.writeFsFile(targetPath, file.content);
        setWorkspaceFiles(prev =>
          prev.map(f =>
            f.id === id
              ? { ...f, dirty: false, filePath: targetPath, lastModified: Date.now() }
              : f,
          ),
        );
      } catch (err: any) {
        alert(`Save failed: ${err.message}`);
      }
    },
    [workspaceFiles],
  );

  const handleOpenDiskFile = useCallback(
    async (path: string) => {
      const existing = workspaceFiles.find(f => f.filePath === path || f.name === path);
      if (existing) {
        setActiveFileId(existing.id);
        setRightPanelTab('code');
        return;
      }
      try {
        const data = await backendClient.readFsFile(path);
        if (!data) throw new Error('Could not read file');
        const name = path.split(/[/\\]/).pop() || path;
        const newFile: WorkspaceFile = {
          id: uid('file'),
          name,
          language: data.language,
          content: data.content,
          lastModified: Date.now(),
          filePath: data.path,
          dirty: false,
        };
        setWorkspaceFiles(prev => [...prev, newFile]);
        setActiveFileId(newFile.id);
        setRightPanelTab('code');
      } catch (err: any) {
        alert(`Open failed: ${err.message}`);
      }
    },
    [workspaceFiles],
  );

  return {
    workspaceFiles,
    activeFileId,
    setActiveFileId,
    rightPanelTab,
    setRightPanelTab,
    handleFileChange,
    handleAddFile,
    handleCloseFile,
    handleSaveFile,
    handleOpenDiskFile,
  };
}
