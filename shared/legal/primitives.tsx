// `React` is imported explicitly: the server bundle (esbuild, classic JSX
// runtime) needs it in scope, unlike Vite's automatic runtime on the client.
import React, { type ReactNode } from "react";

// Shared building blocks for the legal pages, used by both the React pages
// (client) and the server-rendered HTML versions. The server version exists
// because verifiers and crawlers (Google's OAuth brand review, for one) fetch
// the raw HTML and don't run the SPA; an empty <div id="root"> reads as
// "no content".
//
// Keep these files free of hooks, router imports and browser globals so they
// can be rendered with renderToStaticMarkup on the server. Tailwind classes
// style the SPA; the server shell styles the same elements by tag.

export const LEGAL_LAST_UPDATED = "September 5, 2026";
export const PRIVACY_POLICY_PATH = "/privacy-policy";
export const TERMS_OF_SERVICE_PATH = "/termsofservice";

export type RenderLink = (href: string, children: ReactNode, className: string) => ReactNode;

const LINK_CLASS = "text-cyan-400 hover:text-cyan-300";

export function makeLegalPrimitives(renderLink?: RenderLink) {
  const H2 = ({ children }: { children: ReactNode }) => <h2 className="mt-10 text-xl font-semibold text-white">{children}</h2>;
  const H3 = ({ children }: { children: ReactNode }) => <h3 className="mt-6 text-base font-semibold text-slate-100">{children}</h3>;
  const P = ({ children }: { children: ReactNode }) => <p className="mt-3 text-slate-300 leading-relaxed">{children}</p>;
  const UL = ({ children }: { children: ReactNode }) => <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-300">{children}</ul>;
  const A = ({ href, children }: { href: string; children: ReactNode }) => {
    const external = /^(https?:|mailto:)/.test(href);
    if (external) {
      return <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>{children}</a>;
    }
    return <>{renderLink ? renderLink(href, children, LINK_CLASS) : <a href={href} className={LINK_CLASS}>{children}</a>}</>;
  };
  return { H2, H3, P, UL, A };
}
