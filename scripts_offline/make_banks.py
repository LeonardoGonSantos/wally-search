"""Gera bancos de centroides INT8 a partir de dataset local.

Requisitos: pip install torch torchvision pillow numpy scikit-learn tqdm
"""

import argparse
import json
import math
import os
from pathlib import Path
from typing import List, Tuple

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
from sklearn.cluster import KMeans
import torch
import torchvision
import torchvision.transforms as T
from tqdm import tqdm


def parse_args():
    parser = argparse.ArgumentParser(description="Gerar bancos INT8 para o app Wally")
    parser.add_argument('--dataset', type=Path, default=Path('dataset'), help='Diretório raiz do dataset estruturado')
    parser.add_argument('--output', type=Path, default=Path('../banks'), help='Diretório de saída para os bancos')
    parser.add_argument('--clusters', type=int, default=12, help='Número de centroides por parte')
    parser.add_argument('--image-size', type=int, default=160, help='Tamanho padrão dos crops (quadrados)')
    parser.add_argument('--seed', type=int, default=42)
    return parser.parse_args()


def list_samples(dataset_root: Path) -> List[Tuple[str, Path]]:
    samples = []
    for character_dir in dataset_root.glob('*'):
        if not character_dir.is_dir():
            continue
        if character_dir.name == 'negatives_hard':
            for image_path in character_dir.glob('*.jpg'):
                samples.append(('negatives_hard:frame', image_path))
            continue
        for part_dir in character_dir.glob('*'):
            if not part_dir.is_dir():
                continue
            for image_path in part_dir.glob('*.jpg'):
                samples.append((f'{character_dir.name}:{part_dir.name}', image_path))
    return samples


def build_transforms(image_size: int):
    return T.Compose([
        T.Resize((image_size, image_size)),
        T.ToTensor()
    ])


def augment(image: Image.Image) -> List[Image.Image]:
    variants = [image]
    rotations = [-15, -8, 8, 15]
    factors = [0.85, 1.0, 1.15]
    for angle in rotations:
        variants.append(image.rotate(angle, resample=Image.BILINEAR, expand=False))
    for brightness in factors:
        variants.append(ImageEnhance.Brightness(image).enhance(brightness))
    for contrast in factors:
        variants.append(ImageEnhance.Contrast(image).enhance(contrast))
    variants.append(image.filter(ImageFilter.GaussianBlur(radius=1.2)))
    return variants


def extract_embeddings(images: List[Image.Image], model, transform) -> np.ndarray:
    embeddings = []
    with torch.inference_mode():
        for img in images:
            tensor = transform(img).unsqueeze(0)
            feat = model(tensor).numpy()[0]
            embeddings.append(feat)
    return np.stack(embeddings)


def mobilenet_features():
    backbone = torchvision.models.mobilenet_v3_small(weights="IMAGENET1K_V1")
    backbone.classifier = torch.nn.Identity()
    backbone.eval()
    return backbone


def quantize_centroids(centroids: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(centroids, axis=1, keepdims=True)
    norms[norms == 0] = 1
    normalized = centroids / norms
    quantized = np.clip(np.round(normalized * 127), -127, 127).astype(np.int8)
    return quantized


def main():
    args = parse_args()
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    dataset_root = args.dataset
    output_dir = args.output
    output_dir.mkdir(parents=True, exist_ok=True)

    samples = list_samples(dataset_root)
    if not samples:
        raise SystemExit('Nenhuma amostra encontrada. Certifique-se de seguir a estrutura dataset/<personagem>/<parte>/*.jpg')

    model = mobilenet_features()
    transform = build_transforms(args.image_size)

    index_metadata = {
        'version': 1,
        'embeddingSize': 1280,
        'banks': [],
        'color': {}
    }

    grouped = {}
    for label, path in samples:
        grouped.setdefault(label, []).append(path)

    for label, paths in tqdm(grouped.items(), desc='Processando partes'):
        character, part = label.split(':')
        augmented_images = []
        for image_path in paths:
            image = Image.open(image_path).convert('RGB')
            augmented_images.extend(augment(image))
        embeddings = extract_embeddings(augmented_images, model, transform)
        k = min(args.clusters, embeddings.shape[0])
        kmeans = KMeans(n_clusters=k, n_init='auto', random_state=args.seed)
        kmeans.fit(embeddings)
        centroids = quantize_centroids(kmeans.cluster_centers_)
        file_name = f'{character}_{part}.i8.bin'
        output_path = output_dir / file_name
        output_path.write_bytes(centroids.tobytes())
        index_metadata['banks'].append({
            'character': character,
            'part': part,
            'file': file_name,
            'count': int(embeddings.shape[0]),
            'k': int(k)
        })

    with open(output_dir / 'index.json', 'w', encoding='utf-8') as f:
        json.dump(index_metadata, f, ensure_ascii=False, indent=2)

    print('Bancos gerados em', output_dir)


if __name__ == '__main__':
    main()
