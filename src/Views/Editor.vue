<script setup lang="ts">
import { ref } from 'vue';
import IrEditor from '../Controls/BaseIrEditor/RichTextEditor.vue';
import Code from '../Controls/EditorPlugin/EditableCodeBlock.vue';

const editorRef = ref<InstanceType<typeof IrEditor>>()
const content = ref('<p>初始内容</p>')

function insertCodeBlock() {
  editorRef.value?.insertVueComponent('CodeBlock',{
    modelValue: 'print("Hello,world!")',
    language: 'python'
  })
}
</script>
<template>
  <v-sheet>
    <IrEditor ref="editorRef" v-model="content"/>
    <v-btn @click="insertCodeBlock()">插入代码块</v-btn>
    <Code language="javascript" max-height="500px"/>
  </v-sheet>
</template>