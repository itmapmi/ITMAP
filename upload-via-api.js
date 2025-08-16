import fs from 'fs';
import fetch from 'node-fetch';

const baseUrl = 'http://localhost:5000';

async function uploadData() {
  try {
    // First login to get session
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

    // Get session cookie
    const cookies = loginResponse.headers.get('set-cookie');
    console.log('Login successful, got session cookie');

    // Read upload data
    const uploadData = JSON.parse(fs.readFileSync('upload-data.json', 'utf8'));
    
    // Upload the data
    const uploadResponse = await fetch(`${baseUrl}/api/admin/bulk-upload-support-matrix`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies
      },
      body: JSON.stringify(uploadData)
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Upload failed: ${uploadResponse.status} - ${errorText}`);
    }

    const result = await uploadResponse.json();
    console.log('Upload successful!');
    console.log('Results:', JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('Upload error:', error.message);
  }
}

uploadData();