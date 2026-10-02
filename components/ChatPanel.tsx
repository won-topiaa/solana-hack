"use client";

// The left side of the agent page: the conversation, the approval card for an
// action waiting for the user's yes or no, and the message box with a photo button.

import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { CaseView } from "@/lib/web/view";
import { preparePhoto, type PhotoForUpload } from "./photoUpload";

type Props = {
  view: CaseView;
  busy: string | null;
  suggestions: string[];
  onSend: (text: string, photo?: PhotoForUpload) => Promise<boolean>;
  onAnswer: (approved: boolean) => void;
};

/** Only Solana Explorer links become clickable; any other address in a message stays plain text. */
const EXPLORER_URL = /(https:\/\/explorer\.solana\.com\/[^\s<>"']+)/g;

function MessageText({ text }: { text: string }) {
  return (
    <>
      {text.split(EXPLORER_URL).map((part, index) => {
        if (index % 2 === 0) return <Fragment key={index}>{part}</Fragment>;
        const url = part.replace(/[.,;:)]+$/, ""); // punctuation after a link is not part of it
        return (
          <Fragment key={index}>
            <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {url}
            </a>
            {part.slice(url.length)}
          </Fragment>
        );
      })}
    </>
  );
}

export function ChatPanel({ view, busy, suggestions, onSend, onAnswer }: Props) {
  const [draft, setDraft] = useState("");
  const [photo, setPhoto] = useState<PhotoForUpload | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Keep the newest message in sight.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [view.chat.length, view.approval, busy]);

  const blocked = Boolean(busy) || Boolean(view.approval);

  async function send(text: string) {
    if (blocked || (!text.trim() && !photo)) return;
    if (await onSend(text.trim(), photo ?? undefined)) {
      setDraft("");
      setPhoto(null);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(draft);
    }
  }

  async function pickPhoto(file: File | undefined) {
    setPhotoError(null);
    if (!file) return;
    try {
      setPhoto(await preparePhoto(file));
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "The photo could not be used");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex h-full min-h-[480px] flex-col rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {view.chat.length === 0 && (
          <p className="text-sm text-zinc-500">
            {view.persona
              ? "The persona's goal and assets are loaded. Ask the agent to compare the options."
              : "Say how much cash you need, by when, and whether you want to use your home, a watch, or are not sure yet."}
          </p>
        )}
        {view.chat.map((message, index) => (
          <div key={index} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm [overflow-wrap:anywhere] ${
                message.role === "user" ? "bg-violet-600 text-white" : "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
              }`}
            >
              <MessageText text={message.text} />
            </div>
          </div>
        ))}
        {view.approval && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
            <p className="font-semibold text-amber-900 dark:text-amber-200">Your approval is needed</p>
            <p className="mt-1 text-amber-900 dark:text-amber-100">{view.approval.summary}</p>
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Devnet demo: after you approve, the app signs with a demo wallet. Nothing runs before you choose.</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => onAnswer(true)}
                className="rounded-md bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => onAnswer(false)}
                className="rounded-md border border-amber-400 px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:text-amber-200 dark:hover:bg-amber-900"
              >
                Decline
              </button>
            </div>
          </div>
        )}
        {busy && (
          <p className="flex items-center gap-2 text-sm text-zinc-500" role="status">
            <span className="h-2 w-2 animate-pulse rounded-full bg-violet-500" />
            {busy}
          </p>
        )}
        <div ref={endRef} />
      </div>

      {suggestions.length > 0 && !blocked && (
        <div className="flex flex-wrap gap-2 border-t border-zinc-100 px-4 pt-3 dark:border-zinc-900">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => void send(suggestion)}
              className="rounded-full border border-zinc-300 px-3 py-1 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="space-y-2 p-4">
        {photo && (
          <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            {photo.previewUrl && (
              // A local preview of the user's own photo (a blob: URL), so next/image does not apply.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo.previewUrl} alt="Photo to send" className="h-10 w-10 rounded object-cover" />
            )}
            <span>{photo.name} will be sent with your message.</span>
            <button type="button" onClick={() => setPhoto(null)} className="underline">
              Remove
            </button>
          </div>
        )}
        {photoError && <p className="text-xs text-red-600">{photoError}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={2000}
            disabled={blocked}
            placeholder={view.approval ? "Answer the approval request first" : "Message the agent (Enter to send, Shift+Enter for a new line)"}
            className="min-h-[44px] flex-1 resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" className="hidden" onChange={(event) => void pickPhoto(event.target.files?.[0])} />
          <button
            type="button"
            disabled={blocked}
            onClick={() => fileRef.current?.click()}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Photo
          </button>
          <button type="submit" disabled={blocked || (!draft.trim() && !photo)} className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
            Send
          </button>
        </div>
        <p className="text-[11px] text-zinc-500">Use made-up details: this is a demo. Photos may show serial numbers; they stay off-chain.</p>
      </form>
    </div>
  );
}
