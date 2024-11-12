figma.showUI(__html__, {
  width: 400,
  height: 600
});

function getTextNodesFromSelection() {
  const selection = figma.currentPage.selection;
  console.log('Current selection:', selection);
  if (selection.length === 0) {
    console.log('No selection');
    return [];
  }

  const frame = selection[0];
  console.log('Selected frame:', frame);
  if (frame.type !== 'FRAME') {
    console.log('Selected item is not a frame');
    return [];
  }

  const textNodes = frame.findAll(node => node.type === 'TEXT') as TextNode[];
  console.log('Found text nodes:', textNodes);
  const filteredNodes = textNodes
    .map(node => node.characters.trim())
    .filter(text => text.split(' ').length > 3);
  console.log('Filtered text nodes:', filteredNodes);
  return filteredNodes;
}

function updateTextNodes() {
  const textNodes = getTextNodesFromSelection();
  console.log('Sending text nodes to UI:', textNodes);
  figma.ui.postMessage({
    type: 'update-text-nodes',
    textNodes: textNodes
  });
}

figma.on('selectionchange', () => {
  console.log('Selection changed');
  updateTextNodes();
});

async function callGeminiAPI(apiKey: string, prompt: string, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        })
      });

      const data = await response.json();
      console.log('Raw Gemini Response:', JSON.stringify(data));

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}, message: ${JSON.stringify(data)}`);
      }

      // Extract the generated text from the response
      let generatedText = '';
      if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
        generatedText = data.candidates[0].content.parts[0].text;
      } else {
        throw new Error('Unexpected response structure from Gemini API: ' + JSON.stringify(data));
      }

      // Remove any markdown formatting and trim whitespace
      generatedText = generatedText.replace(/```(?:json)?\s*|\s*```/g, '').trim();

      console.log('Cleaned Gemini Response:', generatedText);

      // Attempt to parse the JSON
      try {
        const parsedJSON = JSON.parse(generatedText);
        return parsedJSON;
      } catch (parseError) {
        console.error('Error parsing JSON:', parseError);
        throw new Error('Failed to parse Gemini API response as JSON: ' + generatedText);
      }
    } catch (error) {
      console.error(`Attempt ${i + 1} failed:`, error);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retrying
    }
  }
  throw new Error('Max retries reached for Gemini API call');
}

async function createCopiesOfSelectedFrame(numVariations: number, generatedCopies: any, selectedNodeIndices: number[]) {
  const selection = figma.currentPage.selection;
  if (selection.length === 0 || selection[0].type !== 'FRAME') {
    figma.notify('Please select a frame to duplicate');
    return;
  }

  const originalFrame = selection[0] as FrameNode;
  const copies: FrameNode[] = [];

  for (let i = 0; i < numVariations; i++) {
    const copy = originalFrame.clone();
    copy.x = originalFrame.x + (originalFrame.width + 20) * (i + 1); // 20px gap between frames
    copy.name = `${originalFrame.name} - Variation ${i + 1}`;
    figma.currentPage.appendChild(copy);

    // Apply generated copy to selected text nodes
    const textNodes = copy.findAll(node => node.type === 'TEXT') as TextNode[];
    let generatedTexts: string[] = [];

    if (generatedCopies && typeof generatedCopies === 'object') {
      const variantKey = `variant_${i + 1}`;
      if (generatedCopies[variantKey] && typeof generatedCopies[variantKey] === 'object') {
        generatedTexts = Object.values(generatedCopies[variantKey] as object).map(String);
      }
    }

    for (let j = 0; j < selectedNodeIndices.length; j++) {
      const nodeIndex = selectedNodeIndices[j];
      if (nodeIndex < textNodes.length && j < generatedTexts.length) {
        try {
          await figma.loadFontAsync(textNodes[nodeIndex].fontName as FontName);
          textNodes[nodeIndex].characters = generatedTexts[j];
        } catch (fontError) {
          console.error(`Failed to load font for node ${nodeIndex}:`, fontError);
          figma.notify(`Skipped updating text node ${nodeIndex} due to font loading issues`, { timeout: 3000 });
        }
      }
    }

    copies.push(copy);
  }

  // Apply changes to the original frame as well
  const originalTextNodes = originalFrame.findAll(node => node.type === 'TEXT') as TextNode[];
  const originalGeneratedTexts = generatedCopies['variant_1'] ? Object.values(generatedCopies['variant_1'] as object).map(String) : [];

  for (let j = 0; j < selectedNodeIndices.length; j++) {
    const nodeIndex = selectedNodeIndices[j];
    if (nodeIndex < originalTextNodes.length && j < originalGeneratedTexts.length) {
      try {
        await figma.loadFontAsync(originalTextNodes[nodeIndex].fontName as FontName);
        originalTextNodes[nodeIndex].characters = originalGeneratedTexts[j];
      } catch (fontError) {
        console.error(`Failed to load font for original node ${nodeIndex}:`, fontError);
        figma.notify(`Skipped updating original text node ${nodeIndex} due to font loading issues`, { timeout: 3000 });
      }
    }
  }

  figma.currentPage.selection = [originalFrame, ...copies];
  figma.viewport.scrollAndZoomIntoView([originalFrame, ...copies]);
}

figma.ui.onmessage = async (msg) => {
  console.log('Received message from UI:', { ...msg, apiKey: msg.apiKey ? msg.apiKey.substring(0, 5) + '...' : undefined });
  if (msg.type === 'generate-copy') {
    const { apiKey, combinedText, toneOfVoice, numVariations, specialInstructions, selectedNodeIndices } = msg;
    if (!apiKey) {
      console.error('API Key is missing');
      figma.ui.postMessage({
        type: 'generate-copy-error',
        message: 'API Key is missing'
      });
      return;
    }

    try {
      console.log('Sending request to Gemini...');
      const prompt = `Generate ${numVariations} unique variants of the following input text: ${combinedText}\n\nConsider the following instructions:\nTone: ${toneOfVoice}.\nSpecial instructions: ${specialInstructions}\n\nPlease output the variants in JSON format.\n\nEach sentence in the variant should maintain a word count close to the corresponding sentence in the input text. For example, if the first sentence of the input text has 6 words, the first sentence of each variant should also have around 6 words. Similarly, if the second sentence has 20 words, the second sentence of each variant should also have around 20 words.\n\nEnsure the number of sentences in each variant matches the number of sentences in the input text.\n\nFor example, if the input has 2 sentences and we need 2 variations, the output should be:\n{\n "variant_1": { "text_1": "First variant of the first sentence", "text_2": "First variant of the second sentence" },\n "variant_2": { "text_1": "Second variant of the first sentence", "text_2": "Second variant of the second sentence" }\n}`;
      
      console.log('Final prompt:', prompt);
      
      const parsedResponse = await callGeminiAPI(apiKey, prompt);
      console.log('Parsed response:', parsedResponse);
      
      // Format the response for display and application to designs
      let formattedResponse: string[] = [];
      if (typeof parsedResponse === 'object' && !Array.isArray(parsedResponse)) {
        formattedResponse = Object.entries(parsedResponse).map(([key, value]) => {
          if (typeof value === 'object' && value !== null) {
            return `${key.toUpperCase()}:\n${Object.values(value).join('\n')}`;
          }
          return '';
        }).filter(Boolean);
      } else {
        throw new Error('Unexpected response format from API: ' + JSON.stringify(parsedResponse));
      }

      figma.ui.postMessage({
        type: 'generate-copy-response',
        message: formattedResponse.join('\n\n')
      });

      console.log('Selected node indices:', selectedNodeIndices);
      console.log('Generated copies:', parsedResponse);

      // After successfully generating the copy, create copies of the selected frame and apply the generated text
      await createCopiesOfSelectedFrame(numVariations, parsedResponse, selectedNodeIndices);

      figma.notify('Generated copies have been applied to the designs');
    } catch (error) {
      console.error('Error in generate-copy process:', error);
      let errorMessage = 'An error occurred while generating copy. ';
      if (error instanceof Error) {
        errorMessage += error.message;
        console.error('Error stack:', error.stack);
      } else {
        errorMessage += 'An unknown error occurred: ' + JSON.stringify(error);
      }
      figma.ui.postMessage({
        type: 'generate-copy-error',
        message: errorMessage
      });
      figma.notify('Error: ' + errorMessage, { timeout: 5000 });
    }
  } else if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};

// Initial call to populate the UI with any existing selection
console.log('Plugin started');
updateTextNodes();

// Keep the plugin running
figma.on('run', () => {
  console.log('Plugin run');
  updateTextNodes();
});
