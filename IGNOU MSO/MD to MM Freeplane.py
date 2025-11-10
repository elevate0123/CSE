import sys
import os
import re
from xml.etree.ElementTree import Element, SubElement, ElementTree, tostring
from xml.dom import minidom

def is_heading(line):
    return re.match(r'^\s{0,3}(#{1,6})\s+(.*)', line)

def is_checkbox(line):
    return re.match(r'^\s*[-*]\s+\[( |x|X)\]\s+(.*)', line)

def is_bullet(line):
    return re.match(r'^\s*[-*]\s+(.*)', line)

def is_link(text):
    match = re.match(r'^\[(.*?)\]\((.*?)\)$', text)
    return match.groups() if match else None

def prettify(elem):
    rough_string = tostring(elem, 'utf-8')
    reparsed = minidom.parseString(rough_string)
    return reparsed.toprettyxml(indent="  ")

def md_to_tree(md_lines):
    root = Element("map", version="freeplane 1.9.13")
    root_node = SubElement(root, "node", TEXT="Mindmap from Markdown")
    current_nodes = {0: root_node}
    current_level = 0
    pending_note = ""

    for line in md_lines:
        line = line.rstrip()

        # Heading
        heading_match = is_heading(line)
        if heading_match:
            level = len(heading_match.group(1))
            text = heading_match.group(2).strip()
            parent = current_nodes.get(level - 1, root_node)
            node = SubElement(parent, "node", TEXT=text)
            current_nodes[level] = node
            current_level = level
            pending_note = ""
            continue

        # Checkbox
        checkbox_match = is_checkbox(line)
        if checkbox_match:
            checked = checkbox_match.group(1).lower() == 'x'
            text = checkbox_match.group(2).strip()
            node = SubElement(current_nodes[current_level], "node", TEXT=text)
            SubElement(node, "attribute", NAME="checkbox", VALUE="checked" if checked else "unchecked")
            continue

        # Bullet
        bullet_match = is_bullet(line)
        if bullet_match:
            text = bullet_match.group(1).strip()
            bullet_node = SubElement(current_nodes[current_level], "node", TEXT=text)
            continue

        # Link as a node
        link_match = is_link(line.strip())
        if link_match:
            text, url = link_match
            link_node = SubElement(current_nodes[current_level], "node", TEXT=text)
            SubElement(link_node, "hook", NAME="ExternalObject", URI=url)
            continue

        # Paragraph / Note
        if line.strip():
            pending_note += line.strip() + "\n"
        else:
            # Empty line — end of paragraph, add note
            if pending_note.strip():
                richcontent = SubElement(current_nodes[current_level], "richcontent", TYPE="NOTE")
                html = SubElement(richcontent, "html")
                body = SubElement(html, "body")
                body.text = pending_note.strip()
                pending_note = ""

    # Add last note if pending
    if pending_note.strip():
        richcontent = SubElement(current_nodes[current_level], "richcontent", TYPE="NOTE")
        html = SubElement(richcontent, "html")
        body = SubElement(html, "body")
        body.text = pending_note.strip()

    return root

def convert_md_to_mm(input_file, output_file):
    with open(input_file, "r", encoding="utf-8") as f:
        lines = f.readlines()

    tree = md_to_tree(lines)
    xml_str = prettify(tree)

    with open(output_file, "w", encoding="utf-8") as f:
        f.write(xml_str)

    print(f"✅ Converted '{input_file}' → '{output_file}' successfully.")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python md_to_freeplane.py input.md output.mm")
    else:
        convert_md_to_mm(sys.argv[1], sys.argv[2])
