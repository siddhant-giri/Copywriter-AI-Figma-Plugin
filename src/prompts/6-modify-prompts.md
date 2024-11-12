Now collect all the following information from the user inputs:

textNodes, toneOfVoice, numVariations, specialInstructions, selectedNodes

selectedNodes is a combined text from textNodes. Combine all of them into a single string seperated by full stops.

Now use the following prompt when contacting Gemini API:

`Generate ${numVariations} unique variants of the following input text: ${selectedNodes} \n\Consider the following instructions:\nTone: ${toneOfVoice}.\nSpecial instructions: ${specialInstructions}\n\nPlease output the variants in JSON format. \n\nEach sentence in the variant should maintain a word count close to the corresponding sentence in the input text. For example, if the first sentence of the input text has 6 words, the first sentence of each variant should also have around 6 words. Similarly, if the second sentence has 20 words, the second sentence of each variant should also have around 20 words. \n\nEnsure the number of sentences in each variant matches the number of sentences in the input text.\n\nFor example, if the input has 2 sentences, the output should be: \n{\n "text_1": "Variant of the first sentence", \n "text_2": "Variant of the second sentence"\n}`

Console log the final prompt that you are going to use.
