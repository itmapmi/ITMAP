echo "Uploading support matrix data..."
echo "Logging in..."
curl -c cookies.txt -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@itmap.com","password":"admin123"}'

echo "\nUploading categories and features..."
curl -b cookies.txt -X POST http://localhost:5000/api/admin/bulk-upload-support-matrix \
  -H "Content-Type: application/json" \
  -d @api-upload-data.json

echo "\nUpload complete!"