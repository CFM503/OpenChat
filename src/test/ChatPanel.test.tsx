import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatPanel } from '../components/ChatPanel';
import type { ChatMessage } from '../core/types';

describe('ChatPanel Component Attachments Integration', () => {
  it('should successfully stage a text file upload, show staging preview, and send it via callback', async () => {
    const handleSendMessage = vi.fn();

    // 1. Render the ChatPanel component
    const { container } = render(
      <ChatPanel
        messages={[]}
        onSendMessage={handleSendMessage}
        isStreaming={false}
      />
    );

    // 2. Select the hidden file input
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    // 3. Create a mock text file
    const fileContent = 'const val = "hello attachments";';
    const textFile = new File([fileContent], 'test_script.js', { type: 'text/javascript' });

    // 4. Simulate selecting the file
    fireEvent.change(fileInput, { target: { files: [textFile] } });

    // 5. Wait for FileReader onload to complete and render the staged file preview card
    await waitFor(() => {
      expect(screen.getByText('test_script.js')).toBeInTheDocument();
    });

    // Check size rendering (32 bytes)
    expect(screen.getByText('32 B')).toBeInTheDocument();

    // 6. Click the send button
    const sendButton = container.querySelector('#chat-send-btn') as HTMLButtonElement;
    expect(sendButton).not.toBeDisabled();
    fireEvent.click(sendButton);

    // 7. Verify the message callback was invoked with the correct attachment payload
    expect(handleSendMessage).toHaveBeenCalledTimes(1);
    expect(handleSendMessage).toHaveBeenLastCalledWith('', [
      {
        name: 'test_script.js',
        type: 'text/javascript',
        size: 32,
        content: fileContent,
      }
    ]);

    // 8. Confirm staged files list is cleared after sending
    expect(screen.queryByText('test_script.js')).not.toBeInTheDocument();
  });

  it('should successfully stage an image file upload as base64 Data URL', async () => {
    const handleSendMessage = vi.fn();

    const { container } = render(
      <ChatPanel
        messages={[]}
        onSendMessage={handleSendMessage}
        isStreaming={false}
      />
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    // Create a mock image file (1x1 PNG transparent pixel base64 mock)
    const imageFile = new File(['dummy_png_bytes'], 'avatar.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [imageFile] } });

    // Wait for staging card to render
    await waitFor(() => {
      expect(screen.getByText('avatar.png')).toBeInTheDocument();
    });

    // Check that it rendered the image thumbnail element
    const imgThumbnail = container.querySelector('.staged-attachment-thumbnail') as HTMLImageElement;
    expect(imgThumbnail).not.toBeNull();
    // FileReader readAsDataURL should convert the file into a base64 string
    await waitFor(() => {
      expect(imgThumbnail.src).toContain('data:image/png;base64,');
    });

    // Click Send
    const sendButton = container.querySelector('#chat-send-btn') as HTMLButtonElement;
    fireEvent.click(sendButton);

    // Verify attachments list has the base64 content
    expect(handleSendMessage).toHaveBeenCalledTimes(1);
    const sentAttachments = handleSendMessage.mock.calls[0][1];
    expect(sentAttachments[0].name).toBe('avatar.png');
    expect(sentAttachments[0].type).toBe('image/png');
    expect(sentAttachments[0].content).toContain('data:image/png;base64,');
  });

  it('should support removing staged attachments before sending', async () => {
    const handleSendMessage = vi.fn();

    const { container } = render(
      <ChatPanel
        messages={[]}
        onSendMessage={handleSendMessage}
        isStreaming={false}
      />
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hello'], 'doc.txt', { type: 'text/plain' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('doc.txt')).toBeInTheDocument();
    });

    // Click the close/remove button
    const removeButton = container.querySelector('.staged-attachment-remove') as HTMLButtonElement;
    expect(removeButton).not.toBeNull();
    fireEvent.click(removeButton);

    // Verify it is removed from the screen
    await waitFor(() => {
      expect(screen.queryByText('doc.txt')).not.toBeInTheDocument();
    });

    // Send button should be disabled now since input and staging are empty
    const sendButton = container.querySelector('#chat-send-btn') as HTMLButtonElement;
    expect(sendButton).toBeDisabled();
  });

  it('should render the web search button and trigger onToggleWebSearch when clicked', () => {
    const handleToggleWebSearch = vi.fn();
    const { container } = render(
      <ChatPanel
        messages={[]}
        onSendMessage={() => {}}
        isStreaming={false}
        webSearchEnabled={false}
        onToggleWebSearch={handleToggleWebSearch}
        hasSearchKey={true}
      />
    );

    const searchButton = container.querySelector('#btn-web-search-toggle') as HTMLButtonElement;
    expect(searchButton).not.toBeNull();
    expect(searchButton.className).not.toContain('active');

    fireEvent.click(searchButton);
    expect(handleToggleWebSearch).toHaveBeenCalledWith(true);
  });

  it('should render the web search button as active when webSearchEnabled is true', () => {
    const { container } = render(
      <ChatPanel
        messages={[]}
        onSendMessage={() => {}}
        isStreaming={false}
        webSearchEnabled={true}
        hasSearchKey={true}
      />
    );

    const searchButton = container.querySelector('#btn-web-search-toggle') as HTMLButtonElement;
    expect(searchButton).not.toBeNull();
    expect(searchButton.className).toContain('active');
  });
});
