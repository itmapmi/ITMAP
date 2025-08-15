import itmapLogo from "@assets/ITMAP_logo_transparent_1755237362280.png";

export default function About() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-16">
          <div className="flex justify-center mb-8">
            <img src={itmapLogo} alt="ITMAP" className="h-28 w-auto" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-6">About ITMAP</h1>
          <div className="text-xl text-blue-600 font-semibold mb-8">
            Unbiased. Comprehensive.
          </div>
        </div>

        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Our Mission</h2>
            <p className="text-gray-600 leading-relaxed">
              ITMAP is dedicated to providing unbiased, comprehensive technology intelligence that empowers 
              enterprise decision-makers to make informed choices about their technology stack. We deliver 
              independent analysis, detailed vendor comparisons, and strategic insights that cut through 
              marketing noise to reveal the truth about technology solutions.
            </p>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">What Sets Us Apart</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Unbiased Analysis</h3>
                <p className="text-gray-600">
                  Our research is completely independent, free from vendor influence or bias.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Comprehensive Coverage</h3>
                <p className="text-gray-600">
                  We cover the full spectrum of enterprise technology markets and vendors.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Data-Driven Insights</h3>
                <p className="text-gray-600">
                  Our analysis is based on rigorous methodology and real-world data.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Expert Analysis</h3>
                <p className="text-gray-600">
                  Our team consists of industry veterans with deep technical expertise.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Our Team</h2>
            <p className="text-gray-600 leading-relaxed">
              The ITMAP team brings together decades of experience in enterprise technology, 
              market research, and strategic consulting. Our analysts have worked at leading 
              technology companies and research firms, giving them unique insights into both 
              vendor capabilities and customer needs.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}