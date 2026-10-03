"use client";

// The left side of the agent page: the conversation, the approval card for an
// action waiting for the user's yes or no, and the message box with a photo button.

import { ArrowUp, ImagePlus, ShieldCheck, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { CaseView } from "@/lib/web/view";
import { preparePhoto, type PhotoForUpload } from "./photoUpload";
import { Avatar } from "./ui";

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
            <a href={url} target="_blank" rel="noreferrer" className="underline decoration-neutral-500 underline-offset-4 hover:text-white">
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
    <div className="flex h-full min-h-[520px] flex-col">
      <div className="flex items-center gap-3 border-b border-neutral-800 px-5 py-4">
        <Avatar who="agent" />
        <div>
          <p className="text-sm font-medium text-neutral-100">Ownflow agent</p>
          <p className="text-xs text-neutral-500">Compares every path. Acts only after you approve.</p>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-6">
        {view.chat.length === 0 && (
          <div className="flex items-start gap-3">
            <Avatar who="agent" />
            <p className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm leading-relaxed text-neutral-300">
              {view.persona
                ? "The persona's goal and assets are loaded. Ask me to compare the options."
                : "How much cash do you need, and by when? Tell me whether you want to use your home, a watch, or are not sure yet."}
            </p>
          </div>
        )}
        {view.chat.map((message, index) =>
          message.role === "user" ? (
            <div key={index} className="flex items-start justify-end gap-3">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm text-neutral-100 [overflow-wrap:anywhere]">
                {message.text}
              </div>
              <Avatar who="user" />
            </div>
          ) : (
            <div key={index} className="flex items-start gap-3">
              <Avatar who="agent" />
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm leading-relaxed text-neutral-300 [overflow-wrap:anywhere]">
                <MessageText text={message.text} />
              </div>
            </div>
          ),
        )}
        {view.approval && (
          <div className="flex items-start gap-3">
            <Avatar who="agent" />
            <div className="max-w-[85%] flex-1 space-y-3 rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-neutral-800 px-3 py-1 text-sm text-neutral-100">
                <ShieldCheck size={15} className="text-violet-400" />
                Your approval is needed
              </div>
              <p className="px-1 text-sm leading-relaxed text-neutral-300">{view.approval.summary}</p>
              <p className="px-1 text-xs text-neutral-500">
                {view.approval.needsWallet
                  ? "Devnet: your wallet will show the transaction to sign. Nothing runs before you sign."
                  : !view.approval.onChain
                    ? "Nothing runs before you choose."
                    : view.wallet
                      ? "Devnet: after you approve, the simulated partner signs this step. Nothing runs before you choose."
                      : "Devnet demo: after you approve, the app signs with a demo wallet. Nothing runs before you choose."}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => onAnswer(true)}
                  className="flex-1 rounded-lg bg-white px-3 py-2 text-sm font-medium text-black transition hover:bg-neutral-200 disabled:opacity-40"
                >
                  {view.approval.needsWallet ? "Approve and sign in wallet" : "Approve"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => onAnswer(false)}
                  className="flex-1 rounded-lg border border-neutral-800 px-3 py-2 text-sm font-medium text-neutral-200 transition hover:bg-neutral-900 disabled:opacity-40"
                >
                  Decline
                </button>
              </div>
            </div>
          </div>
        )}
        {busy && (
          <div className="flex items-center gap-3" role="status">
            <Avatar who="agent" />
            <span className="animate-pulse text-sm text-neutral-400">{busy}</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {suggestions.length > 0 && !blocked && (
        <div className="flex flex-wrap gap-2 px-5 pb-3">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => void send(suggestion)}
              className="rounded-full border border-neutral-800 bg-neutral-950 px-3.5 py-1.5 text-left text-xs text-neutral-300 transition hover:border-neutral-700 hover:text-white"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="px-5 pb-5">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3 focus-within:border-neutral-700">
          {photo && (
            <div className="mb-2 flex items-center gap-2 text-xs text-neutral-400">
              {photo.previewUrl && (
                // A local preview of the user's own photo (a blob: URL), so next/image does not apply.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.previewUrl} alt="Photo to send" className="h-10 w-10 rounded-lg border border-neutral-800 object-cover" />
              )}
              <span className="truncate">{photo.name}</span>
              <button type="button" onClick={() => setPhoto(null)} aria-label="Remove the photo" className="text-neutral-500 hover:text-white">
                <X size={14} />
              </button>
            </div>
          )}
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={2000}
            disabled={blocked}
            placeholder={view.approval ? "Answer the approval request first" : "Ask anything..."}
            className="w-full resize-none bg-transparent px-1 text-sm text-neutral-100 outline-none placeholder:text-neutral-500 disabled:opacity-60"
          />
          <div className="mt-1 flex items-center justify-between">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" className="hidden" onChange={(event) => void pickPhoto(event.target.files?.[0])} />
            <button
              type="button"
              disabled={blocked}
              onClick={() => fileRef.current?.click()}
              aria-label="Add a watch photo"
              title="Add a watch photo"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-800 text-neutral-400 transition hover:border-neutral-700 hover:text-white disabled:opacity-40"
            >
              <ImagePlus size={16} />
            </button>
            <button
              type="submit"
              disabled={blocked || (!draft.trim() && !photo)}
              aria-label="Send"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-black transition hover:bg-neutral-200 disabled:opacity-30"
            >
              <ArrowUp size={16} strokeWidth={2.25} />
            </button>
          </div>
        </div>
        {photoError && <p className="mt-2 text-xs text-red-400">{photoError}</p>}
        <p className="mt-2 text-[11px] text-neutral-600">Use made-up details: this is a demo. Photos may show serial numbers; they stay off-chain.</p>
      </form>
    </div>
  );
}
