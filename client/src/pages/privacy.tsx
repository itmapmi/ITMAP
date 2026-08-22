import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useSeo } from "@/hooks/use-seo";

export default function PrivacyPage() {
  useSeo({
    title: "Privacy Notice — ITMAP.ai",
    description: "How ITMAP.ai collects, uses, shares, and retains account and traffic data.",
    path: "/privacy",
  });

  return (
    <div className="min-h-screen bg-[#1e2130] text-slate-200">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8 lg:py-20">
        <Link href="/" className="mb-8 inline-flex items-center text-sm text-cyan-400 transition-colors hover:text-cyan-300">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to ITMAP
        </Link>

        <article className="rounded-2xl border border-white/10 bg-slate-900/80 p-6 shadow-2xl sm:p-10">
          <h1 className="text-3xl font-bold text-white sm:text-4xl">Privacy Notice</h1>
          <p className="mt-2 text-sm text-slate-400">Last updated: August 22, 2026</p>

          <div className="prose prose-invert prose-slate mt-8 max-w-none">
            <p className="text-slate-300">
              This notice applies to every visitor to ITMAP.ai, including people who browse without creating an account.
              Traffic collection begins when a page loads, before sign-in.
            </p>

            <h2 className="mt-8 text-xl font-semibold text-white">Data we collect</h2>
            <ul className="list-disc space-y-2 pl-5 text-slate-300">
              <li><strong>Account data:</strong> name, company, work email, job role, profile details, and login history.</li>
              <li><strong>Activity data:</strong> pages, markets, reports, vendors, filters, searches, interactions, and time spent.</li>
              <li><strong>Traffic and device data:</strong> random first-party visitor and session identifiers, page path, referring page, campaign parameters, browser user agent, full IP address, and approximate country, region, and city.</li>
            </ul>
            <p className="text-slate-300">
              We do not use browser fingerprinting, request GPS location, or trust a browser-supplied IP address or location.
            </p>

            <h2 className="mt-8 text-xl font-semibold text-white">Visitor and session cookies</h2>
            <p className="text-slate-300">
              We use an HTTP-only first-party visitor cookie to recognize the same browser over time and a separate
              HTTP-only traffic-session cookie that expires after 30 minutes of inactivity. These identifiers are random
              and do not contain your name, email address, or device fingerprint.
            </p>

            <h2 className="mt-8 text-xl font-semibold text-white">Approximate location processing</h2>
            <p className="text-slate-300">
              Our server sends the full request IP address to <strong>ipwho.is</strong>, a third-party GeoIP service,
              solely to derive approximate country, region, and city. The provider receives the IP address as part of
              that lookup and processes it under its own privacy terms. ITMAP does not send your name, email address,
              page activity, or visitor identifier with the lookup.
            </p>

            <h2 className="mt-8 text-xl font-semibold text-white">How we use data</h2>
            <ul className="list-disc space-y-2 pl-5 text-slate-300">
              <li>Operate, secure, troubleshoot, and improve the service.</li>
              <li>Measure traffic trends, geographic demand, and market interest.</li>
              <li>Associate a browser’s traffic history with an account after sign-in.</li>
              <li>Provide the account-based market-interest features described in our <Link href="/terms" className="text-cyan-400 hover:text-cyan-300">Terms of Service</Link>.</li>
            </ul>

            <h2 className="mt-8 text-xl font-semibold text-white">Retention and access</h2>
            <p className="text-slate-300">
              Traffic records, including full IP addresses, are retained indefinitely unless deletion is required by
              applicable law or ITMAP chooses to remove them. Detailed traffic intelligence is restricted to authorized
              ITMAP administrators.
            </p>

            <h2 className="mt-8 text-xl font-semibold text-white">Questions and requests</h2>
            <p className="text-slate-300">
              Contact <a href="mailto:privacy@itmap.ai" className="text-cyan-400 hover:text-cyan-300">privacy@itmap.ai</a> for
              privacy questions or requests. Available rights vary by jurisdiction.
            </p>
          </div>
        </article>
      </div>
    </div>
  );
}