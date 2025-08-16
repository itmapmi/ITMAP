import fs from 'fs';
import fetch from 'node-fetch';

const baseUrl = 'http://localhost:5000';

async function uploadNetAppData() {
  try {
    // First login to get session
    console.log('Logging in...');
    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'admin@itmap.com',
        password: 'admin123'
      })
    });

    if (!loginResponse.ok) {
      throw new Error(`Login failed: ${loginResponse.status}`);
    }

    const cookies = loginResponse.headers.get('set-cookie');
    console.log('Login successful');

    // Read NetApp data
    const netappData = JSON.parse(fs.readFileSync('netapp-update.json', 'utf8'));
    console.log(`Found ${netappData.supportData.length} NetApp support records`);
    
    // Upload the NetApp data
    console.log('Uploading NetApp support data...');
    const uploadResponse = await fetch(`${baseUrl}/api/admin/bulk-upload-support-matrix`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies
      },
      body: JSON.stringify(netappData)
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Upload failed: ${uploadResponse.status} - ${errorText}`);
    }

    const result = await uploadResponse.json();
    console.log('NetApp upload successful!');
    console.log('Results:', JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('NetApp upload error:', error.message);
  }
}

uploadNetAppData();