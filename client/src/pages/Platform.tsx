import itmapLogo from "@assets/ITMAP_logo_transparent_1755237362280.png";
import { BarChart3, TrendingUp, Users, Shield, Search, FileText, Target, Zap } from "lucide-react";

export default function Platform() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-16">
          <div className="flex justify-center mb-8">
            <img src={itmapLogo} alt="ITMAP" className="h-28 w-auto" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-6">The ITMAP Platform</h1>
          <div className="text-xl text-blue-600 font-semibold mb-8">
            Unbiased. Comprehensive.
          </div>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            A comprehensive technology intelligence platform that provides enterprise decision-makers 
            with the insights they need to make informed technology choices.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 mb-16">
          <div className="bg-white rounded-lg shadow-lg p-6 text-center">
            <div className="bg-blue-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <BarChart3 className="h-8 w-8 text-blue-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Vendor Evaluation Analysis</h3>
            <p className="text-gray-600">Interactive vendor positioning with detailed capability analysis.</p>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-6 text-center">
            <div className="bg-green-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <TrendingUp className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Market Intelligence</h3>
            <p className="text-gray-600">Real-time market trends and vendor performance tracking.</p>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-6 text-center">
            <div className="bg-purple-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <Users className="h-8 w-8 text-purple-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Vendor Comparison</h3>
            <p className="text-gray-600">Side-by-side feature and capability comparisons.</p>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-6 text-center">
            <div className="bg-red-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <Shield className="h-8 w-8 text-red-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Research Reports</h3>
            <p className="text-gray-600">In-depth analysis and strategic recommendations.</p>
          </div>
        </div>

        <div className="max-w-4xl mx-auto space-y-8">
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Platform Features</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="flex items-start space-x-3">
                <Search className="h-6 w-6 text-blue-600 mt-1" />
                <div>
                  <h3 className="font-semibold text-gray-900">Advanced Search</h3>
                  <p className="text-gray-600">Powerful search and filtering capabilities across all vendors and markets.</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <FileText className="h-6 w-6 text-blue-600 mt-1" />
                <div>
                  <h3 className="font-semibold text-gray-900">Custom Reports</h3>
                  <p className="text-gray-600">Generate tailored reports for your specific technology requirements.</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Target className="h-6 w-6 text-blue-600 mt-1" />
                <div>
                  <h3 className="font-semibold text-gray-900">Scoring Methodology</h3>
                  <p className="text-gray-600">Transparent, criteria-based vendor evaluation framework.</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Zap className="h-6 w-6 text-blue-600 mt-1" />
                <div>
                  <h3 className="font-semibold text-gray-900">Real-time Updates</h3>
                  <p className="text-gray-600">Live data feeds and automated vendor news analysis.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Why Choose ITMAP?</h2>
            <div className="space-y-4">
              <div className="border-l-4 border-blue-500 pl-4">
                <h3 className="font-semibold text-gray-900">Unbiased Research</h3>
                <p className="text-gray-600">Independent analysis free from vendor influence or sponsorship.</p>
              </div>
              <div className="border-l-4 border-green-500 pl-4">
                <h3 className="font-semibold text-gray-900">Comprehensive Coverage</h3>
                <p className="text-gray-600">Complete market landscape analysis across all major technology categories.</p>
              </div>
              <div className="border-l-4 border-purple-500 pl-4">
                <h3 className="font-semibold text-gray-900">Expert Insights</h3>
                <p className="text-gray-600">Analysis by industry veterans with deep technical and market expertise.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}