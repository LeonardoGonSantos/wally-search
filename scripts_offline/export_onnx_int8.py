"""Exporta NanoDet-Tiny ou SSD-Lite MobileNet para ONNX INT8.

Requisitos: pip install torch onnx onnxruntime onnxruntime-tools
"""

import argparse
from pathlib import Path

import numpy as np
import onnx
from onnxruntime.quantization import CalibrationDataReader, QuantFormat, QuantType, quantize_static
import torch


class FolderCalibrationData(CalibrationDataReader):
    def __init__(self, folder: Path, input_name: str, input_size: int):
        self.files = list(folder.glob('*.npy'))
        self.input_name = input_name
        self.input_size = input_size
        self.index = 0

    def get_next(self):
        if self.index >= len(self.files):
            return None
        array = np.load(self.files[self.index])
        self.index += 1
        return {self.input_name: array.astype(np.float32)}


def parse_args():
    parser = argparse.ArgumentParser(description='Exportar modelo INT8 para o app Wally')
    parser.add_argument('--checkpoint', type=Path, required=True, help='Checkpoint PyTorch do detector')
    parser.add_argument('--output', type=Path, default=Path('../models/nanodet_int8.onnx'))
    parser.add_argument('--input-size', type=int, default=160)
    parser.add_argument('--input-name', type=str, default='images')
    parser.add_argument('--calibration', type=Path, help='Pasta com tensores .npy para calibração')
    parser.add_argument('--model', choices=['nanodet', 'ssdlite'], default='nanodet')
    return parser.parse_args()


def load_model(args):
    if args.model == 'nanodet':
        from models.nanodet import NanoDetTiny  # type: ignore
        model = NanoDetTiny()
    else:
        from models.ssdlite import SSDMobileNetLite  # type: ignore
        model = SSDMobileNetLite()
    checkpoint = torch.load(args.checkpoint, map_location='cpu')
    if 'state_dict' in checkpoint:
        model.load_state_dict(checkpoint['state_dict'])
    else:
        model.load_state_dict(checkpoint)
    model.eval()
    return model


def export_onnx(model, args):
    dummy = torch.randn(1, 3, args.input_size, args.input_size)
    torch.onnx.export(
        model,
        dummy,
        args.output.as_posix(),
        input_names=[args.input_name],
        output_names=['scores'],
        dynamic_axes={args.input_name: {0: 'batch'}, 'scores': {0: 'batch'}},
        opset_version=13
    )
    print('Modelo ONNX salvo em', args.output)


def quantize(onnx_path: Path, args):
    if not args.calibration:
        print('Sem amostras de calibração (.npy). Pulando quantização estática.')
        return
    reader = FolderCalibrationData(args.calibration, args.input_name, args.input_size)
    quantize_static(
        model_input=onnx_path.as_posix(),
        model_output=onnx_path.as_posix(),
        calibration_data_reader=reader,
        quant_format=QuantFormat.QDQ,
        activation_type=QuantType.QInt8,
        weight_type=QuantType.QInt8,
        optimize_model=True
    )
    print('Quantização INT8 aplicada.')


def main():
    args = parse_args()
    model = load_model(args)
    export_onnx(model, args)
    quantize(args.output, args)


if __name__ == '__main__':
    main()
