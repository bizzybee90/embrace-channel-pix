import { Card } from '@/components/ui/card';

export default function Privacy() {
  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <h1 className="text-4xl font-bold mb-6">Privacy Policy</h1>
      
      <Card className="p-6 space-y-6">
        <section>
          <h2 className="text-2xl font-semibold mb-3">1. Information We Collect</h2>
          <p className="text-muted-foreground">
            We collect the following information to provide customer service:
          </p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
            <li>Name and contact information (email address, phone number)</li>
            <li>Message content and conversation history</li>
            <li>Channel preferences (SMS, email, web chat)</li>
            <li>Customer service interaction timestamps</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">2. How We Use Your Information</h2>
          <p className="text-muted-foreground">
            Your information is used exclusively to:
          </p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
            <li>Provide customer support and respond to your inquiries</li>
            <li>Maintain conversation history for service continuity</li>
            <li>Improve our customer service processes</li>
            <li>Comply with legal obligations</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">3. Third-Party Processors</h2>
          <p className="text-muted-foreground mb-2">
            We work with the following trusted service providers:
          </p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li><strong>Claude AI (Anthropic)</strong> - AI-powered message analysis and routing</li>
            <li><strong>Twilio</strong> - SMS message delivery</li>
            <li><strong>Gmail/Google</strong> - Email communications</li>
            <li><strong>Supabase</strong> - Secure data storage and infrastructure</li>
          </ul>
          <p className="text-muted-foreground mt-2">
            All processors are GDPR-compliant and handle your data securely.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">4. Data Retention</h2>
          <p className="text-muted-foreground">
            We retain your data for <strong>365 days</strong> from your last interaction, unless you request earlier deletion. 
            After this period, data is either anonymized or securely deleted in accordance with our retention policy.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">5. Your Rights (GDPR)</h2>
          <p className="text-muted-foreground mb-2">You have the following rights regarding your personal data:</p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li><strong>Right to Access:</strong> Request a copy of all data we hold about you</li>
            <li><strong>Right to Erasure:</strong> Request deletion of your personal information</li>
            <li><strong>Right to Rectification:</strong> Request correction of inaccurate data</li>
            <li><strong>Right to Portability:</strong> Receive your data in a machine-readable format</li>
            <li><strong>Right to Object:</strong> Object to processing of your personal data</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">6. How to Exercise Your Rights</h2>
          <div className="space-y-3 text-muted-foreground">
            <p>You can exercise your rights by:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Texting <strong>"MY DATA"</strong> to request a data export</li>
              <li>Texting <strong>"FORGET"</strong> or <strong>"DELETE"</strong> to request data deletion</li>
              <li>Emailing us at <a href="mailto:hello@maccleaning.uk" className="text-primary hover:underline">hello@maccleaning.uk</a></li>
              <li>Contacting your customer service representative</li>
            </ul>
            <p className="mt-3">
              We will respond to all requests within <strong>30 days</strong> as required by GDPR.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">7. Data Security</h2>
          <p className="text-muted-foreground">
            We implement industry-standard security measures including encryption, access controls, 
            and regular security audits to protect your personal information from unauthorized access, 
            disclosure, or destruction.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">8. Contact Information</h2>
          <div className="text-muted-foreground space-y-1">
            <p><strong>Data Protection Officer:</strong> hello@maccleaning.uk</p>
            <p><strong>Company Address:</strong> 18 Quantock Crescent, Emerson Valley</p>
            <p><strong>Supervisory Authority:</strong> Information Commissioner's Office (ICO), United Kingdom</p>
          </div>
        </section>

        <section>
          <p className="text-sm text-muted-foreground italic">
            Last updated: {new Date().toLocaleDateString()}
          </p>
        </section>
      </Card>
    </div>
  );
}
