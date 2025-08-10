import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface SimpleImageUploaderProps {
  value?: string;
  onChange: (url: string) => void;
  className?: string;
}

export function SimpleImageUploader({ value, onChange, className }: SimpleImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file type",
        description: "Please upload an image file",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      toast({
        title: "File too large",
        description: "Please upload an image smaller than 5MB",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      console.log("Getting upload URL...");
      const response = await apiRequest("POST", "/api/objects/upload");
      const { uploadURL } = await response.json();
      console.log("Got upload URL:", uploadURL);

      console.log("Uploading file:", file.name);
      const uploadResponse = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.statusText}`);
      }

      console.log("Upload successful");
      // Convert the upload URL to a proper object path
      const urlParts = uploadURL.split('?')[0]; // Remove query parameters
      const pathMatch = urlParts.match(/\.private\/uploads\/(.+)$/);
      const objectPath = pathMatch ? `/objects/uploads/${pathMatch[1]}` : uploadURL;
      console.log("Setting object path:", objectPath);
      onChange(objectPath);
      
      toast({
        title: "Success",
        description: "Image uploaded successfully",
      });
    } catch (error) {
      console.error("Upload failed:", error);
      toast({
        title: "Upload failed",
        description: "Failed to upload image. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  return (
    <div className={`space-y-3 ${className || ""}`}>
      {/* Current image preview */}
      {value && (
        <div className="relative inline-block">
          <img 
            src={value} 
            alt="Market thumbnail" 
            className="w-32 h-20 object-cover rounded-lg border"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="absolute -top-2 -right-2 h-6 w-6 p-0 rounded-full bg-white"
            onClick={() => onChange("")}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Upload area */}
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
          dragOver 
            ? "border-blue-500 bg-blue-50" 
            : "border-gray-300 hover:border-gray-400"
        }`}
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
      >
        <Upload className="mx-auto h-8 w-8 text-gray-400 mb-2" />
        <p className="text-sm text-gray-600 mb-3">
          Drop an image here or click to upload
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading..." : "Choose File"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {/* Manual URL input */}
      <div className="relative">
        <Input 
          placeholder="Or enter image URL manually" 
          value={value || ""} 
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}