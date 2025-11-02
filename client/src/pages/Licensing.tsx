export default function Licensing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-4xl mx-auto px-4 py-16 sm:px-6 lg:px-8">
        <div className="bg-white rounded-2xl shadow-xl p-8 sm:p-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-8" data-testid="heading-licensing">
            Licensing & Reprints
          </h1>
          <p className="text-xl text-gray-600 mb-12">Third‑Party Use</p>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-6">
              What requires a license?
            </h2>
            <p className="text-gray-700 mb-4">
              The following always require an itmap.ai reprint license when used by vendors or for promotional/marketing purposes:
            </p>
            <ul className="list-disc list-inside space-y-3 text-gray-700 ml-4">
              <li>Charts, diagrams, matrices, market maps, or other graphics created by itmap.ai</li>
              <li>Research content: report excerpts, key takeaways, ratings, quotes, summaries, or narrative text from our research</li>
              <li>Data points or findings unique to itmap.ai (even if paraphrased) when used to endorse or promote your products/services</li>
              <li>Translations of any itmap.ai content</li>
              <li>Thumbnails/screengrabs of our graphics</li>
              <li>Use of itmap.ai logos, product marks, or badges</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-6">
              What does not require a license?
            </h2>
            <ul className="list-disc list-inside space-y-3 text-gray-700 ml-4">
              <li>Linking to public itmap.ai pages using our article/report titles.</li>
              <li>
                Short, purely editorial citations (e.g., a sentence that references our work in a neutral context) may be permissible for journalists under editorial fair use; however, vendors using citations in marketing must obtain a license. When in doubt, contact us.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-6">
              How the licensing process works
            </h2>
            <div className="space-y-8">
              <div className="border-l-4 border-blue-600 pl-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  1. Submit a request to <a href="mailto:priyanka@itmap.com" className="text-blue-600 hover:text-blue-700 underline">priyanka@itmap.com</a>
                </h3>
                <p className="text-gray-700">
                  Provide the asset(s) you want to use, the full context (pages/URLs, channels, languages), and the intended audience/reach.
                </p>
              </div>

              <div className="border-l-4 border-blue-600 pl-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  2. We scope and quote
                </h3>
                <p className="text-gray-700">
                  Fees depend on asset type, distribution, geography, channels, duration, and exclusivity.
                </p>
              </div>

              <div className="border-l-4 border-blue-600 pl-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  3. Agreement & invoice
                </h3>
                <p className="text-gray-700">
                  We'll issue a short reprint license agreement. Once executed and paid, you'll receive approved files and copy.
                </p>
              </div>

              <div className="border-l-4 border-blue-600 pl-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  4. Implement & attribute
                </h3>
                <p className="text-gray-700">
                  Publish using our supplied assets, attribution line, and optional Licensed Reprint badge.
                </p>
              </div>

              <div className="border-l-4 border-blue-600 pl-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  5. Compliance review (optional)
                </h3>
                <p className="text-gray-700">
                  For high-visibility placements, we can pre‑review to ensure brand and research integrity.
                </p>
              </div>

              <div className="border-l-4 border-blue-600 pl-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  6. Renew or retire
                </h3>
                <p className="text-gray-700">
                  Licenses expire at the end of the term. You can renew or remove the content.
                </p>
              </div>
            </div>
          </section>

          <div className="mt-12 p-6 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-gray-700 text-center">
              Questions about licensing? Contact us at{" "}
              <a href="mailto:priyanka@itmap.com" className="text-blue-600 hover:text-blue-700 font-semibold underline">
                priyanka@itmap.com
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
