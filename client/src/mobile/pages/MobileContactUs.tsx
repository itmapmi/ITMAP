import { ArrowLeft, Mail, MessageSquare, Send, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MobileCard, MobileCardHeader, MobileCardTitle, MobileCardDescription } from "@/mobile/components/MobileCard";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useState } from "react";

const contactFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  subject: z.string().min(5, "Subject must be at least 5 characters"),
  message: z.string().min(10, "Message must be at least 10 characters"),
});

type ContactFormData = z.infer<typeof contactFormSchema>;

export default function MobileContactUs() {
  const [isSubmitted, setIsSubmitted] = useState(false);

  const form = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      name: "",
      email: "",
      subject: "",
      message: "",
    },
  });

  const onSubmit = async (data: ContactFormData) => {
    // Simulate form submission
    console.log("Contact form submitted:", data);
    setIsSubmitted(true);
    form.reset();
    
    // Reset success message after 5 seconds
    setTimeout(() => {
      setIsSubmitted(false);
    }, 5000);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="p-4 flex items-center gap-3">
          <Link href="/mobile/dashboard">
            <a data-testid="button-back">
              <Button variant="ghost" size="sm" className="p-2">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </a>
          </Link>
          <h1 className="text-xl font-bold text-gray-900">Contact Us</h1>
        </div>
      </div>

      <div className="p-4">
        {/* Header Section */}
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg p-6 text-white shadow-lg mb-6">
          <div className="flex items-center gap-3 mb-2">
            <MessageSquare className="h-6 w-6" />
            <h2 className="text-2xl font-bold">Get in Touch</h2>
          </div>
          <p className="text-blue-100 text-sm">
            Have questions or feedback? We'd love to hear from you.
          </p>
        </div>

        {/* Success Message */}
        {isSubmitted && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3" data-testid="message-success">
            <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-green-900 text-sm">Message Sent!</h3>
              <p className="text-green-700 text-sm mt-1">
                Thank you for contacting us. We'll get back to you shortly.
              </p>
            </div>
          </div>
        )}

        {/* Contact Info */}
        <div className="grid gap-3 mb-6">
          <MobileCard>
            <MobileCardHeader>
              <div className="flex items-center gap-3">
                <div className="bg-blue-100 p-2 rounded-lg">
                  <Mail className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <MobileCardTitle className="text-base">Email</MobileCardTitle>
                  <MobileCardDescription>
                    <a 
                      href="mailto:contact@itmap.ai" 
                      className="text-blue-600 hover:text-blue-700"
                      data-testid="link-email"
                    >
                      contact@itmap.ai
                    </a>
                  </MobileCardDescription>
                </div>
              </div>
            </MobileCardHeader>
          </MobileCard>
        </div>

        {/* Contact Form */}
        <MobileCard className="mb-6">
          <MobileCardHeader>
            <MobileCardTitle>Send us a Message</MobileCardTitle>
            <MobileCardDescription className="mb-4">
              Fill out the form below and we'll respond as soon as possible.
            </MobileCardDescription>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Your name" 
                          {...field} 
                          data-testid="input-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input 
                          type="email" 
                          placeholder="your.email@example.com" 
                          {...field} 
                          data-testid="input-email"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="subject"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Subject</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="What is this about?" 
                          {...field} 
                          data-testid="input-subject"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="message"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Message</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Tell us more..." 
                          className="min-h-[120px] resize-none" 
                          {...field} 
                          data-testid="input-message"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button 
                  type="submit" 
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={form.formState.isSubmitting}
                  data-testid="button-submit"
                >
                  <Send className="h-4 w-4 mr-2" />
                  {form.formState.isSubmitting ? "Sending..." : "Send Message"}
                </Button>
              </form>
            </Form>
          </MobileCardHeader>
        </MobileCard>

        {/* Additional Info */}
        <MobileCard>
          <MobileCardHeader>
            <MobileCardTitle>Business Inquiries</MobileCardTitle>
            <MobileCardDescription className="mt-2 text-sm leading-relaxed">
              For partnership opportunities, enterprise licensing, or custom research requests, 
              please email us at <a href="mailto:business@itmap.ai" className="text-blue-600 hover:text-blue-700">business@itmap.ai</a>
            </MobileCardDescription>
          </MobileCardHeader>
        </MobileCard>
      </div>
    </div>
  );
}
