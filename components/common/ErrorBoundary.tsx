'use client';
// Class component — React has no hook equivalent for catching render-phase
// errors. Wraps the Puzzle Creator/Solve views so a bad puzzle (corrupted
// FEN, a throwing parse path we didn't anticipate) shows a recoverable
// message instead of blanking the whole app.

import { Component, type ReactNode } from 'react';
import { devlog } from '@/lib/devlog';

interface ErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    devlog('error-boundary', error.message, { stack: error.stack, componentStack: info.componentStack });
    console.error('[ErrorBoundary] caught render error:', error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="max-w-lg mx-auto mt-10 p-6 rounded-lg bg-zinc-900 border border-red-900/60 text-center">
          <p className="text-sm font-semibold text-red-300">Something went wrong.</p>
          <p className="mt-1.5 text-xs text-zinc-400">
            {this.state.error.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={this.reset}
            className="mt-4 px-4 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-sm font-semibold transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
