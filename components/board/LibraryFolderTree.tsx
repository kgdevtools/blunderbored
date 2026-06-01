'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useFolderChildren, useFolderGames } from '@/hooks/useLibrary';
import { createFolder, renameFolder, deleteFolder } from '@/lib/library';
import type { LibraryFolder, LibraryGame } from '@/lib/db';

// ─── Icons ────────────────────────────────────────────────────────────────────

function FolderIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400 shrink-0">
      <path d="M20 6h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2z" />
    </svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400/70 shrink-0">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function PawnIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-zinc-500 shrink-0">
      <path d="M12 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM8.5 11a.5.5 0 0 0-.49.6l1 5A.5.5 0 0 0 9.5 17H11v2H8a1 1 0 0 0 0 2h8a1 1 0 0 0 0-2h-3v-2h1.5a.5.5 0 0 0 .49-.4l1-5a.5.5 0 0 0-.49-.6h-7z"/>
    </svg>
  );
}

// ─── Context menu ─────────────────────────────────────────────────────────────

interface ContextMenuState { id: string; x: number; y: number }

function ContextMenu({
  menu,
  onRename,
  onDelete,
  onClose,
}: {
  menu: ContextMenuState;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[60] bg-zinc-800 border border-zinc-600 rounded shadow-xl text-xs py-1 min-w-[120px]"
      style={{ top: menu.y, left: menu.x }}
    >
      <button
        className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-200 transition-colors"
        onClick={() => { onRename(); onClose(); }}
      >
        Rename
      </button>
      <button
        className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-red-400 transition-colors"
        onClick={() => { onDelete(); onClose(); }}
      >
        Delete
      </button>
    </div>
  );
}

// ─── Shared state passed down ─────────────────────────────────────────────────

interface TreeState {
  selectedFolderId: string | null;
  expandedIds: Set<string>;
  renamingId: string | null;
  deletingId: string | null;
  contextMenu: ContextMenuState | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onStartRename: (id: string) => void;
  onStartDelete: (id: string) => void;
  onOpenContextMenu: (id: string, x: number, y: number) => void;
  onCloseContextMenu: () => void;
  onAddFolder: (parentId: string | null, depth: number) => void;
  onLoad: (game: LibraryGame) => void;
}

// ─── Single folder row ────────────────────────────────────────────────────────

function FolderRow({
  folder,
  tree,
}: {
  folder: LibraryFolder;
  tree: TreeState;
}) {
  const isSelected = tree.selectedFolderId === folder.id;
  const isExpanded = tree.expandedIds.has(folder.id);
  const isRenaming = tree.renamingId === folder.id;
  const isDeleting = tree.deletingId === folder.id;

  const [renameVal, setRenameVal] = useState(folder.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when rename starts
  useEffect(() => {
    if (isRenaming) {
      setRenameVal(folder.name);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [isRenaming, folder.name]);

  const commitRename = useCallback(async () => {
    const trimmed = renameVal.trim();
    if (trimmed && trimmed !== folder.name) {
      await renameFolder(folder.id, trimmed);
    }
    tree.onStartRename('');
  }, [renameVal, folder.id, folder.name, tree]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    if (e.key === 'Escape') tree.onStartRename('');
  };

  const indent = (folder.depth - 1) * 14;

  // ── Deleting confirmation ─────────────────────────────────────────────────
  if (isDeleting) {
    return (
      <div
        className="flex items-center gap-2 px-2 py-1.5 text-xs bg-red-950/40 border-y border-red-800/50"
        style={{ paddingLeft: 8 + indent }}
      >
        <span className="text-red-300 truncate flex-1 min-w-0">Delete &ldquo;{folder.name}&rdquo;?</span>
        <button
          className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white font-semibold shrink-0 transition-colors"
          onClick={async () => { await deleteFolder(folder.id); tree.onStartDelete(''); }}
        >
          Yes
        </button>
        <button
          className="px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 shrink-0 transition-colors"
          onClick={() => tree.onStartDelete('')}
        >
          No
        </button>
      </div>
    );
  }

  // ── Renaming ──────────────────────────────────────────────────────────────
  if (isRenaming) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1" style={{ paddingLeft: 8 + indent }}>
        <FolderIcon open={isExpanded} />
        <input
          ref={inputRef}
          value={renameVal}
          onChange={(e) => setRenameVal(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitRename}
          className="flex-1 min-w-0 bg-zinc-700 border border-zinc-500 rounded px-1.5 py-0.5 text-xs text-zinc-100 outline-none focus:border-blue-400"
          autoFocus
        />
      </div>
    );
  }

  // ── Normal ────────────────────────────────────────────────────────────────
  return (
    <div
      className={`group flex items-center gap-1 px-2 py-1.5 cursor-pointer select-none text-xs leading-none tracking-tight transition-colors
        ${isSelected ? 'bg-zinc-700/80 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'}`}
      style={{ paddingLeft: 8 + indent }}
      onClick={() => { tree.onSelect(folder.id); if (!isExpanded) tree.onToggle(folder.id); }}
      onDoubleClick={() => tree.onStartRename(folder.id)}
      onContextMenu={(e) => { e.preventDefault(); tree.onOpenContextMenu(folder.id, e.clientX, e.clientY); }}
    >
      {/* Expand toggle */}
      <span
        className="w-3 shrink-0 flex items-center justify-center text-zinc-500"
        onClick={(e) => { e.stopPropagation(); tree.onToggle(folder.id); }}
      >
        {isExpanded ? <ChevronDown /> : <ChevronRight />}
      </span>

      <FolderIcon open={isExpanded} />

      <span className="flex-1 truncate">{folder.name}</span>

      {/* Add sub-folder — hidden at depth 3 */}
      {folder.depth < 3 && (
        <button
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-600 transition-all"
          title="New sub-folder"
          onClick={(e) => { e.stopPropagation(); tree.onAddFolder(folder.id, folder.depth + 1); }}
        >
          <PlusIcon />
        </button>
      )}
    </div>
  );
}

// ─── Game item in tree ────────────────────────────────────────────────────────

function GameItem({ game, folderDepth, tree }: { game: LibraryGame; folderDepth: number; tree: TreeState }) {
  // Indent: one level deeper than the containing folder
  const paddingLeft = 8 + folderDepth * 14 + 14; // extra 14 skips the chevron column
  return (
    <div
      className="flex items-center gap-1 px-2 py-1 cursor-pointer select-none text-[11px] leading-none tracking-tight text-zinc-500 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
      style={{ paddingLeft }}
      onClick={() => tree.onLoad(game)}
      title={game.title}
    >
      <span className="w-3 shrink-0" />
      <PawnIcon />
      <span className="flex-1 truncate">{game.title}</span>
    </div>
  );
}

function GameItems({ folderId, folderDepth, tree }: { folderId: string; folderDepth: number; tree: TreeState }) {
  const games = useFolderGames(folderId);
  if (games.length === 0) return null;
  return (
    <>
      {games.map((game) => (
        <GameItem key={game.id} game={game} folderDepth={folderDepth} tree={tree} />
      ))}
    </>
  );
}

// ─── Recursive folder list ────────────────────────────────────────────────────

function FolderList({ parentId, tree, depth = 0 }: { parentId: string | null; tree: TreeState; depth?: number }) {
  const folders = useFolderChildren(parentId);
  return (
    <>
      {folders.map((folder) => (
        <div key={folder.id}>
          <FolderRow folder={folder} tree={tree} />
          {tree.expandedIds.has(folder.id) && (
            <div className="relative">
              {/* Subtle indent guide line */}
              {depth < 2 && (
                <div
                  className="absolute top-0 bottom-0 border-l border-zinc-700/40 pointer-events-none"
                  style={{ left: 14 + folder.depth * 14 }}
                />
              )}
              <FolderList parentId={folder.id} tree={tree} depth={depth + 1} />
              <GameItems folderId={folder.id} folderDepth={folder.depth} tree={tree} />
            </div>
          )}
        </div>
      ))}
    </>
  );
}

// ─── LibraryFolderTree ────────────────────────────────────────────────────────

export function LibraryFolderTree({
  selectedFolderId,
  onSelect,
  onLoad,
}: {
  selectedFolderId: string | null;
  onSelect: (id: string) => void;
  onLoad: (game: LibraryGame) => void;
  mode: 'browse' | 'save';
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const onToggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const onAddFolder = useCallback(async (parentId: string | null, _depth: number) => {
    try {
      const folder = await createFolder('New Folder', parentId);
      // Expand the parent and select + rename the new folder
      if (parentId) setExpandedIds((prev) => new Set([...prev, parentId]));
      onSelect(folder.id);
      setRenamingId(folder.id);
    } catch (err) {
      console.error(err);
    }
  }, [onSelect]);

  const tree: TreeState = {
    selectedFolderId,
    expandedIds,
    renamingId,
    deletingId,
    onLoad,
    contextMenu,
    onSelect,
    onToggle,
    onStartRename: setRenamingId,
    onStartDelete: setDeletingId,
    onOpenContextMenu: (id, x, y) => setContextMenu({ id, x, y }),
    onCloseContextMenu: () => setContextMenu(null),
    onAddFolder,
  };

  return (
    <div className="py-2 flex flex-col h-full">
      {/* Folder list */}
      <div className="flex-1 min-h-0">
        <FolderList parentId={null} tree={tree} />
      </div>

      {/* Root-level new folder */}
      <div className="px-2 pt-1.5 pb-1 border-t border-zinc-700/50 mt-1 shrink-0">
        <button
          className="flex items-center gap-1.5 text-xs font-semibold leading-none tracking-tight text-zinc-500 hover:text-zinc-200 transition-colors w-full py-1"
          onClick={() => onAddFolder(null, 1)}
        >
          <PlusIcon />
          <span>New Folder</span>
        </button>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onRename={() => setRenamingId(contextMenu.id)}
          onDelete={() => setDeletingId(contextMenu.id)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
